import { nativePausedWriter, pausedWritePayload, type PausedWorkoutWriter } from "./native-pauses";
import type * as HealthKit from "@kingstinct/react-native-healthkit";
import {
  eligibility,
  normalizedObservation,
  reconcileObservations,
  syncIdentifier,
  unavailableProvider,
  validateActual,
  validateWindow,
  pausedIntervals,
} from "./shared";
import {
  HealthError,
  SYNC_PREFIX,
  WORKOUTS_APP_ID,
  type ActualWorkout,
  type HealthCursor,
  type HealthProvider,
} from "./types";

export type HealthKitBridge = Pick<
  typeof HealthKit,
  | "isHealthDataAvailableAsync"
  | "requestAuthorization"
  | "authorizationStatusFor"
  | "queryWorkoutSamplesWithAnchor"
  | "queryWorkoutSamples"
  | "saveWorkoutSample"
  | "deleteObjects"
>;
const WORKOUT_TYPE = "HKWorkoutTypeIdentifier";
const SYNC_KEY = "HKSyncIdentifier"; // Native value of HKMetadataKeySyncIdentifier.
const VERSION_KEY = "HKSyncVersion";
const PAGE_SIZE = 100;

export function createHealthKitProvider(
  bridge: HealthKitBridge,
  openSettings: () => Promise<void>,
  pausedWriter?: PausedWorkoutWriter | null
): HealthProvider {
  let writeRequested = false;
  const access = async () => ({
    read: "unknown" as const,
    write:
      bridge.authorizationStatusFor(WORKOUT_TYPE) === 2
        ? ("granted" as const)
        : !writeRequested
          ? ("not_requested" as const)
          : ("denied" as const),
    message:
      "Apple does not disclose read permission denial. No visible records can mean limited access or no records.",
  });
  const ownFilter = (id: string) => ({
    metadata: { withMetadataKey: SYNC_KEY, operatorType: 4, value: syncIdentifier(id) },
  });
  return {
    platform: "apple_health",
    availability: async () => ({
      status: (await bridge.isHealthDataAvailableAsync()) ? "available" : "unavailable",
      message: "HealthKit exercise summaries require a native iPhone build and available Health data.",
    }),
    access,
    requestAccess: async ({ read, write }) => {
      if (!read && !write) return access();
      await bridge.requestAuthorization({ toRead: read ? [WORKOUT_TYPE] : [], toShare: write ? [WORKOUT_TYPE] : [] });
      writeRequested = writeRequested || write;
      return access();
    },
    readPage: async (cursor, window) => {
      const bounded = validateWindow(window);
      if (cursor && cursor.provider !== "apple_health")
        throw new HealthError("wrong_cursor", "Reconnect this provider before syncing.");
      const start = cursor?.window_start ?? bounded.start;
      const response = await bridge.queryWorkoutSamplesWithAnchor({
        limit: PAGE_SIZE,
        ...(cursor?.anchor ? { anchor: cursor.anchor } : {}),
        filter: { date: { startDate: new Date(start), strictStartDate: true } },
      });
      const observations = response.workouts.flatMap((proxy) => {
        const sample = proxy.toJSON();
        const origin = sample.sourceRevision.source.bundleIdentifier;
        const canonical = sample.metadata[SYNC_KEY];
        if (origin === WORKOUTS_APP_ID || (typeof canonical === "string" && canonical.startsWith(SYNC_PREFIX)))
          return [];
        // No route, heart-rate, calories, body measurements or unbounded metadata projection.
        const seconds =
          sample.duration.unit === "min"
            ? sample.duration.quantity * 60
            : sample.duration.unit === "h"
              ? sample.duration.quantity * 3600
              : sample.duration.unit === "s"
                ? sample.duration.quantity
                : NaN;
        return [
          normalizedObservation({
            source_id: `apple_health:${sample.uuid}`,
            provider: "apple_health",
            origin_id: origin || "unknown",
            started_at: sample.startDate,
            ended_at: sample.endDate,
            duration_seconds: seconds,
            duration_basis: "provider_reported",
            activity_type: `healthkit:${sample.workoutActivityType}`,
            ai_eligibility: eligibility(origin, sample.sourceRevision.source.name),
          }),
        ];
      });
      const deleted = response.deletedSamples.map((sample) => `apple_health:${sample.uuid}`);
      const next: HealthCursor = {
        provider: "apple_health",
        window_start: start,
        window_end: cursor?.window_end ?? bounded.end,
        phase: "changes",
        anchor: response.newAnchor,
      };
      return {
        observations: reconcileObservations(observations, deleted),
        deleted_source_ids: deleted,
        next_cursor: next,
        has_more: response.workouts.length + response.deletedSamples.length >= PAGE_SIZE,
        reset_required: false,
        coverage_notes: [
          "Foreground anchored workout summaries only; read denial is not observable. No absence-based deletion is inferred.",
          "The anchor retains a fixed start boundary; later deltas can include newly visible older records.",
        ],
      };
    },
    exportActual: async (workout) => {
      const reason = validateActual(workout);
      if (reason)
        return {
          status: "unsupported",
          canonical_session_id: workout.canonical_session_id,
          revision: workout.revision,
          message: reason,
        };
      if (bridge.authorizationStatusFor(WORKOUT_TYPE) !== 2)
        throw new HealthError("write_denied", "Allow workout writing in Apple Health before exporting.");
      const existing = await bridge.queryWorkoutSamples({
        limit: PAGE_SIZE,
        filter: ownFilter(workout.canonical_session_id),
      });
      const same = existing.find(
        (sample) =>
          sample.sourceRevision.source.bundleIdentifier === WORKOUTS_APP_ID &&
          Number(sample.metadata[VERSION_KEY]) >= workout.revision
      );
      if (same)
        return {
          status: "already_written",
          source_id: `apple_health:${same.uuid}`,
          canonical_session_id: workout.canonical_session_id,
          revision: workout.revision,
        };
      const activity = ({ running: 37, walking: 52, strength: 50, basketball: 6, other: 3000 } as const)[
        workout.activity
      ];
      if (pausedIntervals(workout).length) {
        if (!pausedWriter)
          return {
            status: "unsupported",
            canonical_session_id: workout.canonical_session_id,
            revision: workout.revision,
            message:
              "This native build needs the recorded-pause module before this session can be exported truthfully.",
          };
        const uuid = await pausedWriter.savePausedWorkout(pausedWritePayload(workout, activity));
        return {
          status: "written",
          source_id: `apple_health:${uuid}`,
          canonical_session_id: workout.canonical_session_id,
          revision: workout.revision,
        };
      }
      const saved = await bridge.saveWorkoutSample(
        activity,
        [],
        new Date(workout.started_at),
        new Date(workout.ended_at),
        undefined,
        {
          [SYNC_KEY]: syncIdentifier(workout.canonical_session_id),
          [VERSION_KEY]: workout.revision,
          "hafa.partial": workout.status === "partial",
        }
      );
      return {
        status: "written",
        source_id: `apple_health:${saved.uuid}`,
        canonical_session_id: workout.canonical_session_id,
        revision: workout.revision,
      };
    },
    deleteOwned: async (id) => {
      const records = await bridge.queryWorkoutSamples({ limit: PAGE_SIZE, filter: ownFilter(id) });
      const uuids = records
        .filter((sample) => sample.sourceRevision.source.bundleIdentifier === WORKOUTS_APP_ID)
        .map((sample) => sample.uuid);
      if (uuids.length) await bridge.deleteObjects(WORKOUT_TYPE, { uuids });
    },
    openSettings,
  };
}

export async function createNativeHealthProvider(): Promise<HealthProvider> {
  try {
    const bridge = await import("@kingstinct/react-native-healthkit");
    const { openHealthSettings } = await import("./native-linking.ios");
    const provider = createHealthKitProvider(bridge, openHealthSettings, await nativePausedWriter());
    await provider.availability();
    return provider;
  } catch {
    return unavailableProvider();
  }
}

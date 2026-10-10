import { nativePausedWriter, pausedWritePayload, type PausedWorkoutWriter } from "./native-pauses";
import type * as HealthConnect from "react-native-health-connect";
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
import { HealthError, SYNC_PREFIX, WORKOUTS_APP_ID, type HealthCursor, type HealthProvider } from "./types";

export type HealthConnectBridge = Pick<
  typeof HealthConnect,
  | "getSdkStatus"
  | "initialize"
  | "requestPermission"
  | "getGrantedPermissions"
  | "readRecords"
  | "getChanges"
  | "insertRecords"
  | "deleteRecordsByUuids"
  | "openHealthConnectSettings"
>;

export function createHealthConnectProvider(
  bridge: HealthConnectBridge,
  pausedWriter?: PausedWorkoutWriter | null
): HealthProvider {
  async function access() {
    const permissions = await bridge.getGrantedPermissions();
    const has = (type: "read" | "write") =>
      permissions.some(
        (permission) =>
          permission.accessType === type && "recordType" in permission && permission.recordType === "ExerciseSession"
      );
    return {
      read: has("read") ? ("granted" as const) : ("denied" as const),
      write: has("write") ? ("granted" as const) : ("denied" as const),
      message: "Foreground exercise summaries only. Historical and background permissions are not requested.",
    };
  }
  function project(record: HealthConnect.RecordResult<"ExerciseSession">) {
    const metadata = record.metadata;
    const origin = metadata?.dataOrigin ?? "unknown";
    if (origin === WORKOUTS_APP_ID || metadata?.clientRecordId?.startsWith(SYNC_PREFIX)) return [];
    if (!metadata?.id)
      throw new HealthError("missing_record_id", "The provider returned an exercise without a source ID.");
    return [
      normalizedObservation({
        source_id: `health_connect:${metadata.id}`,
        provider: "health_connect",
        origin_id: origin,
        started_at: record.startTime,
        ended_at: record.endTime,
        duration_seconds: (Date.parse(record.endTime) - Date.parse(record.startTime)) / 1000,
        duration_basis: "elapsed_interval",
        activity_type: `health_connect:${record.exerciseType}`,
        ...(metadata.lastModifiedTime ? { updated_at: metadata.lastModifiedTime } : {}),
        ai_eligibility: eligibility(origin),
      }),
    ];
  }
  return {
    platform: "health_connect",
    availability: async () => {
      const sdk = await bridge.getSdkStatus();
      if (sdk !== 3)
        return {
          status: sdk === 2 ? "update_required" : "unavailable",
          message: "Install/update Health Connect on supported Android devices. Manual training remains available.",
        };
      return {
        status: (await bridge.initialize()) ? "available" : "unavailable",
        message: "Health Connect exercise summaries are available in this native build.",
      };
    },
    access,
    requestAccess: async ({ read, write }) => {
      if (!read && !write) return access();
      await bridge.requestPermission([
        ...(read ? [{ accessType: "read" as const, recordType: "ExerciseSession" as const }] : []),
        ...(write ? [{ accessType: "write" as const, recordType: "ExerciseSession" as const }] : []),
      ]);
      return access();
    },
    readPage: async (cursor, window) => {
      const bounded = validateWindow(window);
      if ((await access()).read !== "granted")
        throw new HealthError("read_denied", "Allow exercise-summary reading in Health Connect to refresh.");
      if (cursor && cursor.provider !== "health_connect")
        throw new HealthError("wrong_cursor", "Reconnect this provider before syncing.");
      if (cursor?.phase === "changes" && cursor.changes_token) {
        const changes = await bridge.getChanges({
          changesToken: cursor.changes_token,
          recordTypes: ["ExerciseSession"],
        });
        if (changes.changesTokenExpired) {
          const restarted = await bootstrap(null, bounded);
          return {
            ...restarted,
            reset_required: true,
            coverage_notes: [
              ...restarted.coverage_notes,
              "Changes token expired. Reconcile the bounded snapshot after all bootstrap pages; deletions outside its coverage remain unknown.",
            ],
          };
        }
        const observations = changes.upsertionChanges.flatMap((change) =>
          change.record.recordType === "ExerciseSession" ? project(change.record) : []
        );
        const deleted = changes.deletionChanges.map((change) => `health_connect:${change.recordId}`);
        return {
          observations: reconcileObservations(observations, deleted),
          deleted_source_ids: deleted,
          next_cursor: { ...cursor, changes_token: changes.nextChangesToken },
          has_more: changes.hasMore,
          reset_required: false,
          coverage_notes: ["Foreground ExerciseSession changes only; no route or background/history permission."],
        };
      }
      return bootstrap(cursor, bounded);
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
      if ((await access()).write !== "granted")
        throw new HealthError("write_denied", "Allow workout writing in Health Connect before exporting.");
      const exerciseType = ({ running: 56, walking: 79, strength: 70, basketball: 5, other: 0 } as const)[
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
        const id = await pausedWriter.savePausedWorkout(pausedWritePayload(workout, exerciseType));
        return {
          status: "written",
          source_id: `health_connect:${id}`,
          canonical_session_id: workout.canonical_session_id,
          revision: workout.revision,
        };
      }
      const ids = await bridge.insertRecords([
        {
          recordType: "ExerciseSession",
          startTime: new Date(workout.started_at).toISOString(),
          endTime: new Date(workout.ended_at).toISOString(),
          exerciseType,
          title: workout.status === "partial" ? "Håfa Workouts — partial session" : "Håfa Workouts",
          metadata: {
            clientRecordId: syncIdentifier(workout.canonical_session_id),
            clientRecordVersion: workout.revision,
            recordingMethod: 3,
          },
        },
      ]);
      if (!ids[0]) throw new HealthError("write_unconfirmed", "The provider did not confirm the saved workout.");
      return {
        status: "written",
        source_id: `health_connect:${ids[0]}`,
        canonical_session_id: workout.canonical_session_id,
        revision: workout.revision,
      };
    },
    deleteOwned: async (id) => bridge.deleteRecordsByUuids("ExerciseSession", [], [syncIdentifier(id)]),
    openSettings: async () => {
      bridge.openHealthConnectSettings();
    },
  };

  async function bootstrap(cursor: HealthCursor | null, window: { start: string; end: string }) {
    // Acquire a Changes token BEFORE paginating the snapshot so intervening writes
    // are recovered as deltas, instead of falling into an initial-read race gap.
    const initialChanges = cursor?.changes_token ? null : await bridge.getChanges({ recordTypes: ["ExerciseSession"] });
    const token = cursor?.changes_token ?? initialChanges?.nextChangesToken;
    const start = cursor?.window_start ?? window.start,
      end = cursor?.window_end ?? window.end;
    const response = await bridge.readRecords("ExerciseSession", {
      timeRangeFilter: { operator: "between", startTime: start, endTime: end },
      pageSize: 100,
      ascendingOrder: true,
      ...(cursor?.page_token ? { pageToken: cursor.page_token } : {}),
    });
    const observations = [
      ...response.records.flatMap(project),
      ...(initialChanges?.upsertionChanges.flatMap((change) =>
        change.record.recordType === "ExerciseSession" ? project(change.record) : []
      ) ?? []),
    ];
    const deleted = initialChanges?.deletionChanges.map((change) => `health_connect:${change.recordId}`) ?? [];
    const next: HealthCursor = {
      provider: "health_connect",
      window_start: start,
      window_end: end,
      phase: response.pageToken ? "bootstrap" : "changes",
      ...(response.pageToken ? { page_token: response.pageToken } : {}),
      changes_token: token,
    };
    return {
      observations: reconcileObservations(observations, deleted),
      deleted_source_ids: deleted,
      next_cursor: next,
      has_more: Boolean(response.pageToken) || Boolean(initialChanges?.hasMore),
      reset_required: false,
      coverage_notes: [
        "Initial foreground exercise snapshot is bounded to the selected window (at most 30 days); older data is not presumed visible.",
      ],
    };
  }
}

export async function createNativeHealthProvider(): Promise<HealthProvider> {
  try {
    const provider = createHealthConnectProvider(
      await import("react-native-health-connect"),
      await nativePausedWriter()
    );
    await provider.availability();
    return provider;
  } catch {
    return unavailableProvider();
  }
}

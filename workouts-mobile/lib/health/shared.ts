import { HealthError, SYNC_PREFIX, type ActualWorkout, type HealthObservation, type HealthProvider } from "./types";

export function unavailableProvider(): HealthProvider {
  const unavailable = async (): Promise<never> => {
    throw new HealthError(
      "native_build_required",
      "Health connections require a rebuilt native iPhone or Android app."
    );
  };
  return {
    platform: "unavailable",
    availability: async () => ({
      status: "native_build_required",
      message: "Use a native build with the health modules installed.",
    }),
    access: async () => ({
      read: "unknown",
      write: "not_requested",
      message: "Health data is unavailable in this build.",
    }),
    requestAccess: unavailable,
    readPage: unavailable,
    exportActual: unavailable,
    deleteOwned: unavailable,
    openSettings: unavailable,
  };
}

export function validateWindow(window: { start: string; end: string }) {
  const start = Date.parse(window.start),
    end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 30 * 86400000) {
    throw new HealthError("invalid_window", "Choose a valid foreground window of at most 30 days.");
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
export function syncIdentifier(id: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new HealthError("invalid_session", "The canonical session ID is invalid.");
  return `${SYNC_PREFIX}${id}`;
}
export function validateActual(workout: ActualWorkout): string | null {
  syncIdentifier(workout.canonical_session_id);
  const start = Date.parse(workout.started_at),
    end = Date.parse(workout.ended_at);
  if (
    !Number.isSafeInteger(workout.revision) ||
    workout.revision < 1 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(workout.active_seconds) ||
    workout.active_seconds <= 0
  ) {
    throw new HealthError(
      "invalid_actual",
      "Only a valid actual completed or partial training interval can be exported."
    );
  }
  if (workout.active_seconds > (end - start) / 1000 + 1)
    throw new HealthError("invalid_actual", "Recorded active time exceeds the workout interval.");
  if (workout.active_intervals) {
    if (!workout.active_intervals.length || workout.active_intervals.length > 1000)
      throw new HealthError("invalid_actual", "Recorded active intervals are missing or too numerous.");
    let previous = start,
      total = 0;
    for (const interval of workout.active_intervals) {
      const a = Date.parse(interval.started_at),
        b = Date.parse(interval.ended_at);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < previous || b <= a || b > end)
        throw new HealthError(
          "invalid_actual",
          "Recorded active intervals must be ordered, within the workout and nonoverlapping."
        );
      previous = b;
      total += (b - a) / 1000;
    }
    if (Math.abs(total - workout.active_seconds) > 1)
      throw new HealthError("invalid_actual", "Recorded intervals do not match active time.");
  } else if (Math.abs((end - start) / 1000 - workout.active_seconds) > 1)
    return "This older session has no recorded pause boundaries. Its app record is preserved; active time will not be guessed.";
  return null;
}
export function eligibility(origin: string, name = ""): "restricted" | "unknown" {
  return /strava/i.test(`${origin} ${name}`) ? "restricted" : "unknown";
}
export function normalizedObservation(
  values: Omit<HealthObservation, "started_at" | "ended_at" | "duration_seconds"> & {
    started_at: Date | string;
    ended_at: Date | string;
    duration_seconds: number;
  }
): HealthObservation {
  const start = new Date(values.started_at),
    end = new Date(values.ended_at);
  if (
    !values.source_id ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start ||
    !Number.isFinite(values.duration_seconds) ||
    values.duration_seconds <= 0 ||
    values.duration_seconds > (end.getTime() - start.getTime()) / 1000 + 1
  )
    throw new HealthError("invalid_record", "The provider returned an invalid exercise interval.");
  return { ...values, started_at: start.toISOString(), ended_at: end.toISOString() };
}
export function reconcileObservations(records: HealthObservation[], deleted: string[]) {
  const removed = new Set(deleted);
  const unique = new Map<string, HealthObservation>();
  for (const record of records) {
    if (!removed.has(record.source_id)) unique.set(record.source_id, { ...record });
  }
  const result = [...unique.values()];
  // Different source IDs are candidates, never automatically equivalent workouts.
  for (const record of result) {
    const overlaps = result.filter(
      (other) =>
        other.source_id !== record.source_id &&
        other.origin_id !== record.origin_id &&
        other.activity_type === record.activity_type &&
        Math.abs(Date.parse(other.started_at) - Date.parse(record.started_at)) <= 60000 &&
        Math.abs(Date.parse(other.ended_at) - Date.parse(record.ended_at)) <= 60000
    );
    if (overlaps.length) record.possible_duplicate_of = overlaps.slice(0, 20).map((other) => other.source_id);
  }
  return result;
}

/** Pauses are the exact complement of recorded active intervals, never inferred from a duration total. */
export function pausedIntervals(workout: ActualWorkout) {
  const reason = validateActual(workout);
  if (reason) throw new HealthError("unsupported_timing", reason);
  if (!workout.active_intervals) return [];
  const pauses: Array<{ started_at: string; ended_at: string }> = [];
  let previous = Date.parse(workout.started_at);
  for (const interval of workout.active_intervals) {
    const start = Date.parse(interval.started_at);
    if (start > previous)
      pauses.push({ started_at: new Date(previous).toISOString(), ended_at: new Date(start).toISOString() });
    previous = Date.parse(interval.ended_at);
  }
  const end = Date.parse(workout.ended_at);
  if (end > previous)
    pauses.push({ started_at: new Date(previous).toISOString(), ended_at: new Date(end).toISOString() });
  return pauses;
}

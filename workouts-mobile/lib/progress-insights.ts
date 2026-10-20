import type { ActualSet, SessionRequest, Workout } from "./models";
import type { UnitSystem } from "./training";

/** Progress presentation: friendly dates, a gentle weekly streak, records and trends. Pure and testable. */

type Effective = { request: Pick<SessionRequest, "started_at" | "actuals">; workout: Workout };

const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
/** "Today", "Yesterday", "Tue, Oct 14", or "Tue, Oct 14, 2025" outside this year. */
export function friendlyDate(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const days = Math.round((day(now) - day(date)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

/** Monday of the week containing `date`, as a local-midnight timestamp. */
function weekStart(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start.getTime();
}
/**
 * Weeks in a row with at least one recorded session, counting back from this week.
 * A week that hasn't had a session yet doesn't break the run: it counts from last week.
 */
export function weekStreak(sessions: Array<{ started_at: string; recorded: boolean }>, now = new Date()) {
  const weeks = new Set(sessions.filter((s) => s.recorded && Number.isFinite(Date.parse(s.started_at)))
    .map((s) => weekStart(new Date(s.started_at))));
  const cursor = new Date(weekStart(now));
  if (!weeks.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 7);
  let count = 0;
  while (weeks.has(cursor.getTime())) {
    count++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return count;
}

const trim = (value: number, places = 2) => String(Number(value.toFixed(places)));
export function formatDistance(meters: number, units: UnitSystem) {
  if (units === "imperial") return `${trim(meters / 1609.344)} mi`;
  return meters >= 1000 ? `${trim(meters / 1000)} km` : `${trim(meters, 0)} m`;
}
export function formatDuration(seconds: number) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : `${seconds}s`;
}
export function formatWeight(set: Pick<ActualSet, "load" | "load_unit" | "load_convention">) {
  if (set.load == null) return "";
  const kinds: Record<string, string> = { per_hand: " each", added: " added", assistance: " assist" };
  const kind = kinds[set.load_convention ?? ""] ?? "";
  return `${trim(set.load)} ${set.load_unit ?? ""}`.trim() + kind;
}

export function exerciseName(workout: Workout, actual: Pick<ActualSet, "block_id" | "exercise_index">) {
  return workout.blocks.find((b) => b.id === actual.block_id)?.exercises[actual.exercise_index]?.name ?? "Exercise";
}

/** Completed sets grouped by exercise, in the order they were done: "Row · 8, 6 reps @ 20 kg". */
export function exerciseLines(request: Pick<SessionRequest, "actuals">, workout: Workout, units: UnitSystem) {
  const groups = new Map<string, { name: string; sets: ActualSet[] }>();
  for (const a of request.actuals) {
    if (!a.completed) continue;
    const key = `${a.block_id}:${a.exercise_index}`;
    const group = groups.get(key) ?? { name: exerciseName(workout, a), sets: [] };
    group.sets.push(a);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ name, sets }) => {
    const reps = sets.filter((s) => s.reps != null).map((s) => s.reps);
    const other = sets.filter((s) => s.reps == null).map((s) =>
      s.duration_seconds != null ? formatDuration(s.duration_seconds) : s.distance_meters != null ? formatDistance(s.distance_meters, units) : "");
    const weights = [...new Set(sets.map(formatWeight).filter(Boolean))];
    const amount = [reps.length ? `${reps.join(", ")} reps` : "", other.filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    return `${name} · ${[amount, weights.length ? `@ ${weights.join(", ")}` : ""].filter(Boolean).join(" ")}`;
  });
}

const kg = (set: ActualSet) => (set.load ?? 0) * (set.load_unit === "lb" ? 0.45359237 : 1);
export interface ExerciseRecord {
  key: string;
  name: string;
  /** Best result in words: "24 kg × 8", "15 reps", "1:30" or "5 km". */
  best: string;
  /** Supporting line: most reps and how many sessions it appears in. */
  detail: string;
  /** Best result per session, oldest first (last 8), for a sparkline. */
  trend: number[];
  lastDone: string;
}
/**
 * Personal bests per exercise from saved sessions. The same exercise is matched by its library id,
 * otherwise by name. Assistance weight is skipped for "heaviest" because less assistance is harder.
 */
export function exerciseRecords(sessions: readonly Effective[], units: UnitSystem): ExerciseRecord[] {
  type Acc = { name: string; heaviest?: ActualSet; mostReps?: ActualSet; longest?: ActualSet; farthest?: ActualSet;
    sessions: Map<string, Record<Metric, number>>; lastDone: string };
  type Metric = "kg" | "reps" | "seconds" | "meters";
  const records = new Map<string, Acc>();
  const sorted = [...sessions].sort((a, b) => a.request.started_at.localeCompare(b.request.started_at));
  for (const { request, workout } of sorted) {
    for (const a of request.actuals) {
      if (!a.completed) continue;
      const prescription = workout.blocks.find((b) => b.id === a.block_id)?.exercises[a.exercise_index];
      if (!prescription?.name.trim()) continue;
      const key = prescription.exercise_id ? `id:${prescription.exercise_id}` : `name:${prescription.name.trim().toLowerCase()}`;
      const r: Acc = records.get(key) ?? { name: prescription.name.trim(), sessions: new Map(), lastDone: request.started_at };
      r.lastDone = request.started_at;
      r.name = prescription.name.trim(); // The newest name wins when a library exercise is renamed.
      const weighted = a.load != null && a.load > 0 && a.load_convention !== "assistance";
      if (weighted && (!r.heaviest || kg(a) > kg(r.heaviest) || (kg(a) === kg(r.heaviest) && (a.reps ?? 0) > (r.heaviest.reps ?? 0))))
        r.heaviest = a;
      if (a.reps != null && (!r.mostReps || a.reps > r.mostReps.reps!)) r.mostReps = a;
      if (a.duration_seconds != null && (!r.longest || a.duration_seconds > r.longest.duration_seconds!)) r.longest = a;
      if (a.distance_meters != null && (!r.farthest || a.distance_meters > r.farthest.distance_meters!)) r.farthest = a;
      const best = r.sessions.get(request.started_at) ?? { kg: 0, reps: 0, seconds: 0, meters: 0 };
      r.sessions.set(request.started_at, { kg: Math.max(best.kg, weighted ? kg(a) : 0), reps: Math.max(best.reps, a.reps ?? 0),
        seconds: Math.max(best.seconds, a.duration_seconds ?? 0), meters: Math.max(best.meters, a.distance_meters ?? 0) });
      records.set(key, r);
    }
  }
  return [...records.entries()].flatMap(([key, r]) => {
    const best = r.heaviest ? `${formatWeight(r.heaviest)}${r.heaviest.reps != null ? ` × ${r.heaviest.reps}` : ""}`
      : r.mostReps ? `${r.mostReps.reps} reps` : r.longest ? formatDuration(r.longest.duration_seconds!)
      : r.farthest ? formatDistance(r.farthest.distance_meters!, units) : "";
    if (!best) return [];
    // The trend follows the same measure as the best result, skipping sessions without it.
    const metric: Metric = r.heaviest ? "kg" : r.mostReps ? "reps" : r.longest ? "seconds" : "meters";
    const trend = [...r.sessions.values()].map((s) => s[metric]).filter((v) => v > 0).slice(-8);
    const count = r.sessions.size;
    const detail = [r.heaviest && r.mostReps ? `Most reps ${r.mostReps.reps}` : null,
      `${count} ${count === 1 ? "session" : "sessions"}`].filter(Boolean).join(" · ");
    return [{ key, name: r.name, best, detail, trend, lastDone: r.lastDone }];
  }).sort((a, b) => b.lastDone.localeCompare(a.lastDone));
}

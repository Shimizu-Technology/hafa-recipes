import type { ActualSet, Workout } from "./models";
import { formatPartScore, partEndedAt, partScore, partSegments, restEndsAt, type ClassRun, type PartResult, type Segment } from "./class-session";

/**
 * Scores and splits a class sends with its session (API contract W2), the review before saving, and the text
 * for WodUp's Log Result. Pure.
 */
type Block = Workout["blocks"][number];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const blockOf = (workout: Workout, id: string) => workout.blocks.find((b) => b.id === id)!;

/** Parts that get a score: started, not skipped, and not marked "not scored". */
export function scoredParts(run: ClassRun, workout: Workout, now: number, actuals: readonly ActualSet[], edits: Record<string, PartResult> = {}) {
  return run.parts.flatMap((part) => {
    const block = blockOf(workout, part.block_id);
    const clockScore = partScore(block, part, now, {}, actuals);
    if (!clockScore) return [];
    // A part the source scores a set way (say, by load) asks for that score, starting empty.
    const explicit = block.score_kind && block.score_kind !== "auto" && block.score_kind !== "none" ? block.score_kind : null;
    const fromClock: PartResult = explicit && clockScore.kind !== explicit ? { block_id: block.id, kind: explicit, origin: clockScore.origin,
      started_at: clockScore.started_at, ended_at: clockScore.ended_at } : clockScore;
    // Timestamps always come from the clock; the person edits only the score.
    const edit = edits[block.id];
    const result: PartResult = edit ? { ...edit, block_id: block.id, started_at: fromClock.started_at, ended_at: fromClock.ended_at,
      origin: fromClock.origin } : fromClock;
    return [{ block, part, result, edited: !!edit }];
  });
}
/** The rest after a part, as a `rest` split on that part: it may run past the part's end, never past `now`. */
export function restSegments(run: ClassRun, workout: Workout, now: number): Segment[] {
  return run.parts.flatMap((part) => {
    const block = blockOf(workout, part.block_id);
    const end = part.skipped ? null : partEndedAt(part, block, now);
    const rest = end == null ? null : restEndsAt(part, block, now);
    if (end == null || rest == null || Math.min(rest, now) <= end) return [];
    return [{ block_id: block.id, kind: "rest" as const, index: 1, started_at: new Date(end).toISOString(), ended_at: new Date(Math.min(rest, now)).toISOString() }];
  });
}
/** `results` and `segments` for the session request, in part order. */
export function classPayload(run: ClassRun, workout: Workout, now: number, actuals: readonly ActualSet[], edits: Record<string, PartResult> = {}) {
  // A score still missing its value stays out of the request rather than make the server refuse every score.
  const results = scoredParts(run, workout, now, actuals, edits).map((x) => x.result).filter((r) => !scoreProblem(r));
  const rests = restSegments(run, workout, now);
  const segments = run.parts.flatMap((part) => [...partSegments(blockOf(workout, part.block_id), part), ...rests.filter((r) => r.block_id === part.block_id)]);
  return { results, segments };
}

/** What's wrong with an edited score, in the words of its field, or null. Mirrors the API's checks. */
export function scoreProblem(r: PartResult): string | null {
  const whole = (v: number | undefined, max: number) => v != null && Number.isInteger(v) && v >= 0 && v <= max;
  if (r.kind === "rounds_reps") {
    if (r.buy_in_done === false) return r.distance_meters != null && r.distance_meters >= 0 ? null : "Enter the buy-in distance you covered.";
    return whole(r.rounds, 1000) && whole(r.reps, 10000) ? null : "Rounds and reps must be whole numbers.";
  }
  if (r.kind === "time") return r.capped ? (whole(r.rounds, 1000) && whole(r.reps, 10000) ? null : "Enter rounds and reps at the cap.")
    : whole(r.time_seconds, 86400) ? null : "Enter a time like 8:42.";
  if (r.kind === "load") return r.load != null && r.load >= 0 && r.load <= 2000 && r.load_unit ? null : "Enter a weight in kg or lb.";
  if (r.kind === "reps") return whole(r.reps, 10000) ? null : "Reps must be a whole number.";
  return null;
}
/** "8:42" → 522; "522" → 522; anything else → null. */
export function parseTime(text: string) {
  const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+)$/);
  if (!m) return null;
  if (m[4] != null) return Number(m[4]);
  const seconds = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number(m[3]) < 60 ? seconds : null;
}
/** Drops the score fields that belong to another kind, so a switch between capped and finished stays valid. */
export function cleanScore(r: PartResult): PartResult {
  const { rounds, reps, time_seconds, load, load_unit, distance_meters, calories, buy_in_done, buy_in_seconds, ...rest } = r;
  const keep: Partial<PartResult> = r.kind === "rounds_reps"
    ? (buy_in_done === false ? { buy_in_done, distance_meters } : { rounds, reps, ...(buy_in_done != null ? { buy_in_done, buy_in_seconds } : {}) })
    : r.kind === "time" ? (r.capped ? { rounds, reps } : { time_seconds, capped: false })
    : r.kind === "load" ? { load, load_unit } : r.kind === "reps" ? { reps } : r.kind === "distance" ? { distance_meters }
    : r.kind === "calories" ? { calories } : {};
  return { ...rest, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) } as PartResult;
}

/** "3 rounds + 12 reps", "8:42", "Capped · 2 rounds + 14 reps", "Buy-in · 900 m". */
const count = (n: number | undefined, word: string) => `${n ?? 0} ${word}${n === 1 ? "" : "s"}`;
export function wodupScore(r: PartResult) {
  if (r.kind === "rounds_reps" && r.buy_in_done !== false) return `${count(r.rounds, "round")} + ${count(r.reps, "rep")}`;
  if (r.kind === "time" && r.capped) return `Capped · ${count(r.rounds, "round")} + ${count(r.reps, "rep")}`;
  return formatPartScore(r);
}
const scalingWord = (r: PartResult) => (r.scaling === "rx" ? "Rx" : r.scaling === "scaled" ? "Scaled" : r.scaling === "custom" ? "Custom" : null);
/**
 * The day's scores, one line per part, ready to paste into WodUp's Log Result. Splits follow on their own line:
 * "  Buy-in 5:48 · Rounds 4:10, 4:02".
 */
export function wodupText(workout: Workout, results: readonly PartResult[], segments: readonly Segment[] = []) {
  const lines = [workout.title];
  for (const r of results) {
    const block: Block | undefined = workout.blocks.find((b) => b.id === r.block_id);
    const scaling = scalingWord(r);
    lines.push(`${block?.label ?? r.block_id}: ${wodupScore(r)}${scaling ? ` · ${scaling}` : ""}${r.scaling_note ? ` (${r.scaling_note})` : ""}`);
    const mine = segments.filter((s) => s.block_id === r.block_id && s.kind !== "rest");
    const span = (s: Segment) => clock(Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000));
    const buyIn = mine.find((s) => s.kind === "buy_in");
    const rounds = mine.filter((s) => s.kind === "round").map(span);
    const splits = [buyIn ? `Buy-in ${span(buyIn)}${buyIn.run_environment === "treadmill" ? " (treadmill)" : ""}` : null,
      rounds.length ? `Rounds ${rounds.join(", ")}` : null].filter(Boolean);
    if (splits.length) lines.push(`  ${splits.join(" · ")}`);
  }
  return lines.join("\n");
}

/** Optional result fields an older or stricter server may refuse; the session itself never depends on them. */
export const resultFields = ["results", "segments", "heart_rate", "recorded_on", "apple_workout_uuid"] as const;
export function withoutResults<T extends object>(request: T): T {
  const copy = { ...request } as Record<string, unknown>;
  for (const key of resultFields) delete copy[key];
  // The watch already owns its Health sample. Optional-score fallback must never turn it into a phone export.
  if ((request as Record<string, unknown>).recorded_on === "watch") {
    copy.recorded_on = "watch";
    if ((request as Record<string, unknown>).apple_workout_uuid != null)
      copy.apple_workout_uuid = (request as Record<string, unknown>).apple_workout_uuid;
  }
  return copy as T;
}
export const carriesResults = (request: object) => resultFields.some((key) =>
  ((request as Record<string, unknown>).recorded_on !== "watch" || !["recorded_on", "apple_workout_uuid"].includes(key)) &&
  (request as Record<string, unknown>)[key] != null);

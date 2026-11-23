import type { ActualSet, Workout } from "./models";
import { amrapFor } from "./timed-circuit";
import { formatCapSeconds, intervalLength, timedFormatFor } from "./timed-execution";

/**
 * A class run part by part: A, rest, B, then C and D. Pure and timestamp-based, like the session clock: each
 * part stores when it started, paused and ended, and everything else (the cap, the rest before the next part,
 * the next part's start) is derived from those times. A part capped or a rest that ran out while the phone was
 * locked has still ended on time, and the next part has started on time.
 */
type Block = Workout["blocks"][number];
export type PartKind = "amrap" | "for_time" | "emom" | "work_rest" | "sets";
export type RunEnvironment = "outdoor" | "treadmill";
export type PartStatus = "pending" | "lead_in" | "running" | "paused" | "resting_after" | "done" | "skipped";

export interface PartRun {
  block_id: string;
  kind: PartKind;
  /** When the part's clock starts, after any lead-in. Absent until the part starts. */
  started_at?: number;
  lead_in_ms?: number;
  /** Set when the person ends the part; a timed part also ends at its cap without this. */
  ended_at?: number;
  skipped?: boolean;
  pauses: Array<{ at: number; until?: number }>;
  /** +15 s / −15 s on the rest before the next part, and "Start now". */
  rest_adjust_ms?: number;
  rest_ended_at?: number;
  /** Each "+1 round", in order. */
  round_taps: number[];
  buy_in_done_at?: number;
  /** Outdoor or treadmill for each run move, by exercise index; treadmill keeps the distance run. */
  runs?: Record<number, { environment: RunEnvironment; distance_meters?: number }>;
}
export interface ClassRun {
  /** End class was chosen while a part was unfinished. */
  ended_early?: boolean;
  parts: PartRun[];
  cursor: number;
  /** Countdown before each timed part; 0 for none. */
  lead_in_ms: number;
}

export function partKind(block: Block): PartKind {
  if (amrapFor(block) != null) return "amrap";
  const format = timedFormatFor(block);
  return format ? format.mode : "sets";
}
export const isTimedPart = (kind: PartKind) => kind !== "sets";
/** The part's clock length: the AMRAP cap, the for-time cap, or interval length × count. */
export function partCapMs(block: Block) {
  const cap = amrapFor(block) ?? (timedFormatFor(block) ? formatCapSeconds(timedFormatFor(block)!) : null);
  return cap == null ? null : cap * 1000;
}
const pausedMs = (part: PartRun, until: number) =>
  part.pauses.reduce((sum, p) => sum + Math.max(0, Math.min(p.until ?? until, until) - p.at), 0);
const openPause = (part: PartRun) => part.pauses.some((p) => p.until == null);
const blockOf = (workout: Workout, part: PartRun) => workout.blocks.find((b) => b.id === part.block_id)!;

/** When the part ended: by the person, by skipping, or at its cap (never while paused). */
export function partEndedAt(part: PartRun, block: Block, now: number) {
  if (part.ended_at != null) return part.ended_at;
  const cap = partCapMs(block);
  if (part.started_at == null || cap == null || openPause(part)) return null;
  const capEnd = part.started_at + cap + pausedMs(part, Infinity);
  return now >= capEnd ? capEnd : null;
}
/** Time on the part's clock: excludes the lead-in and pauses, and stops at the end or cap. */
export function partElapsedMs(part: PartRun, block: Block, now: number) {
  if (part.started_at == null) return 0;
  const end = Math.min(now, partEndedAt(part, block, now) ?? Infinity);
  const elapsed = Math.max(0, end - part.started_at - pausedMs(part, end));
  return Math.min(elapsed, partCapMs(block) ?? Infinity);
}
/** When the rest before the next part ends, or null if there is none or the part hasn't ended. */
export function restEndsAt(part: PartRun, block: Block, now: number) {
  const end = partEndedAt(part, block, now);
  if (end == null || !block.rest_after_seconds) return null;
  return part.rest_ended_at ?? Math.max(end, end + block.rest_after_seconds * 1000 + (part.rest_adjust_ms ?? 0));
}
export function partStatus(part: PartRun, block: Block, now: number): PartStatus {
  if (part.skipped) return "skipped";
  if (part.started_at == null) return "pending";
  const end = partEndedAt(part, block, now);
  if (end != null) return (restEndsAt(part, block, now) ?? 0) > now ? "resting_after" : "done";
  if (now < part.started_at) return "lead_in";
  return openPause(part) ? "paused" : "running";
}

export function planClass(workout: Workout, leadInMs = 0): ClassRun {
  return { parts: workout.blocks.map((block) => ({ block_id: block.id, kind: partKind(block), pauses: [], round_taps: [] })),
    cursor: 0, lead_in_ms: Math.max(0, leadInMs) };
}
function begin(run: ClassRun, part: PartRun, at: number) {
  const lead = isTimedPart(part.kind) ? run.lead_in_ms : 0;
  part.started_at = at + lead;
  if (lead) part.lead_in_ms = lead;
}
/**
 * Moves past parts that have ended, as the clock would have: after a rest, the next part starts when the rest
 * ends (a timed one after its lead-in). With no rest, a set-by-set part starts straight away and a timed part
 * waits for Start.
 */
export function resolve(run: ClassRun, workout: Workout, now: number): ClassRun {
  const next = JSON.parse(JSON.stringify(run)) as ClassRun;
  while (next.cursor < next.parts.length - 1) {
    const part = next.parts[next.cursor], block = blockOf(workout, part);
    const end = part.skipped ? part.ended_at ?? null : partEndedAt(part, block, now);
    if (end == null) break;
    const rest = part.skipped ? null : restEndsAt(part, block, now);
    if (rest != null && rest > now) break;
    next.cursor++;
    const following = next.parts[next.cursor];
    if (following.started_at == null && (rest != null || !isTimedPart(following.kind))) begin(next, following, rest ?? end);
  }
  return next;
}
function edit(run: ClassRun, workout: Workout, now: number, change: (part: PartRun, block: Block, run: ClassRun) => void) {
  const next = resolve(run, workout, now);
  const part = next.parts[next.cursor];
  change(part, blockOf(workout, part), next);
  return resolve(next, workout, now);
}
/** Start the current part now (after the lead-in, for a timed part). */
export const startPart = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part, _block, r) => { if (part.started_at == null) begin(r, part, now); });
export const skipLeadIn = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part) => { if (part.started_at != null && part.started_at > now) part.started_at = now; });
/** Pause stops only this part's clock; pausing during the lead-in cancels it. */
export const pausePart = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part, block) => {
    const status = partStatus(part, block, now);
    if (status === "lead_in") { delete part.started_at; delete part.lead_in_ms; }
    else if (status === "running") part.pauses.push({ at: now });
  });
export const resumePart = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part) => {
    const open = part.pauses.find((p) => p.until == null);
    if (open) open.until = now;
    else if (part.started_at == null) part.started_at = now;
  });
/** The person ends the part early (or a for-time part is finished); a capped part keeps its cap end. */
export const endPart = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part, block) => {
    // During the lead-in there is nothing to end yet; a part ending before its clock starts would end in the future.
    if (part.started_at == null || part.started_at > now || partEndedAt(part, block, now) != null) return;
    const open = part.pauses.find((p) => p.until == null);
    if (open) open.until = now;
    part.ended_at = Math.max(part.started_at, now);
  });
export const skipPart = (run: ClassRun, workout: Workout, now: number) =>
  // A part that already ended, by the person or at its cap, keeps its result.
  edit(run, workout, now, (part, block) => { if (partEndedAt(part, block, now) == null) { part.skipped = true; part.ended_at = now; } });
export const adjustRest = (run: ClassRun, workout: Workout, deltaMs: number, now: number) =>
  edit(run, workout, now, (part, block) => {
    if (partStatus(part, block, now) === "resting_after") part.rest_adjust_ms = (part.rest_adjust_ms ?? 0) + deltaMs;
  });
export const endRest = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part, block) => { if (partStatus(part, block, now) === "resting_after") part.rest_ended_at = now; });

/** AMRAP buy-in and round counter. Taps count only while the part's clock runs. */
export function buyIn(block: Block) {
  return block.exercises.findIndex((e) => e.segment === "buy_in");
}
export const buyInDone = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part, block) => {
    if (buyIn(block) >= 0 && part.buy_in_done_at == null && partStatus(part, block, now) === "running") part.buy_in_done_at = now;
  });
export const tapRound = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part, block) => {
    if (partStatus(part, block, now) !== "running" || (buyIn(block) >= 0 && part.buy_in_done_at == null)) return;
    part.round_taps.push(now);
  });
/**
 * "Every move each interval" parts with more than one move (E6MOM × 3 of sled, run, carry): one
 * "Round done" tap per interval records how long that interval's round took.
 */
export function intervalRounds(block: Block) {
  const format = timedFormatFor(block);
  return format?.mode === "emom" && format.rotation === "together" && block.exercises.length > 1 ? format : null;
}
/** The interval a moment in an interval part falls in, and when that interval began. */
function intervalAt(part: PartRun, block: Block, at: number) {
  const length = intervalLength(intervalRounds(block)!) * 1000;
  const elapsed = partElapsedMs(part, block, at);
  const index = Math.floor(elapsed / length) + 1;
  return { index, started: at - (elapsed - (index - 1) * length) };
}
/** Seconds the current interval's round took, once its "Round done" was tapped; else null. */
export function intervalRoundSeconds(part: PartRun, block: Block, now: number) {
  const last = part.round_taps.at(-1);
  if (last == null || !intervalRounds(block)) return null;
  const tapped = intervalAt(part, block, last);
  return tapped.index === intervalAt(part, block, now).index ? Math.round((last - tapped.started) / 1000) : null;
}
export const tapInterval = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part, block) => {
    if (part.kind !== "emom" || !intervalRounds(block) || partStatus(part, block, now) !== "running") return;
    if (intervalRoundSeconds(part, block, now) != null) return; // One round per interval.
    part.round_taps.push(now);
  });
/** Undo the last round, or the buy-in when no round has been tapped. */
export const undoTap = (run: ClassRun, workout: Workout, now: number) =>
  edit(run, workout, now, (part) => { if (part.round_taps.length) part.round_taps.pop(); else delete part.buy_in_done_at; });
export const setRun = (run: ClassRun, workout: Workout, exerciseIndex: number, environment: RunEnvironment, distance?: number, now = Date.now()) =>
  edit(run, workout, now, (part) => {
    part.runs = { ...part.runs, [exerciseIndex]: { environment, ...(distance != null ? { distance_meters: distance } : {}) } };
  });
/** The API's own run test, so every run it requires Outdoor/Treadmill for gets the choice. */
export const isRun = (e: Block["exercises"][number]) => /\b(run|running|jog|jogging|treadmill)\b/i.test(e.name) && !!e.distance_meters;

/** Running spans of every part, for `active_intervals`; rests and pauses between them are not active time. */
export function classIntervals(run: ClassRun, workout: Workout, now: number) {
  const spans: Array<{ started_at: number; ended_at: number }> = [];
  for (const part of run.parts) {
    if (part.started_at == null || part.started_at > now) continue;
    const block = blockOf(workout, part);
    const end = Math.min(now, partEndedAt(part, block, now) ?? now);
    let from = part.started_at;
    for (const p of [...part.pauses].sort((x, y) => x.at - y.at)) {
      if (p.at > from) spans.push({ started_at: from, ended_at: Math.min(p.at, end) });
      from = Math.max(from, p.until ?? Infinity);
    }
    if (from < end) spans.push({ started_at: from, ended_at: end });
  }
  return spans.filter((s) => s.ended_at > s.started_at);
}

/** One scored part, in the API's `PartResult` shape (W2). */
export interface PartResult {
  block_id: string;
  kind: "rounds_reps" | "time" | "load" | "reps" | "distance" | "calories" | "completed";
  time_seconds?: number; capped?: boolean; rounds?: number; reps?: number;
  buy_in_done?: boolean; buy_in_seconds?: number; load?: number; load_unit?: "kg" | "lb"; distance_meters?: number; calories?: number;
  scaling?: "rx" | "scaled" | "custom"; scaling_note?: string;
  started_at?: string; ended_at?: string; origin: "timer" | "watch" | "manual";
}
/**
 * The clock's score for a part, before the person reviews it. `reps` are the reps into the unfinished round at
 * the cap, and `buy_in_meters` the distance covered when the cap came during the buy-in. `actuals` are the
 * session's logged sets, used for strength and interval parts.
 */
export function partScore(block: Block, part: PartRun, now: number,
  { reps: partialReps = 0, buy_in_meters = 0 }: { reps?: number; buy_in_meters?: number } = {}, actuals: readonly ActualSet[] = []): PartResult | null {
  if (block.score_kind === "none" || part.skipped || part.started_at == null) return null;
  const end = partEndedAt(part, block, now) ?? now;
  const base = { block_id: block.id, origin: "timer" as const,
    started_at: new Date(part.started_at).toISOString(), ended_at: new Date(Math.max(end, part.started_at)).toISOString() };
  const mine = actuals.filter((a) => a.block_id === block.id);
  const buyInIndex = buyIn(block);
  const sinceStart = (at: number) => Math.round((at - part.started_at! - pausedMs(part, at)) / 1000);
  switch (part.kind) {
    case "amrap": {
      if (buyInIndex >= 0 && part.buy_in_done_at == null) {
        // The cap came during the buy-in: the score is the distance covered (the person enters it).
        return { ...base, kind: "rounds_reps", buy_in_done: false, distance_meters: Math.max(0, buy_in_meters) };
      }
      return { ...base, kind: "rounds_reps", rounds: part.round_taps.length, reps: Math.max(0, partialReps),
        ...(buyInIndex >= 0 ? { buy_in_done: true, buy_in_seconds: sinceStart(part.buy_in_done_at!) } : {}) };
    }
    case "for_time": {
      const cap = partCapMs(block);
      if (part.ended_at == null && cap != null && partEndedAt(part, block, now) != null)
        return { ...base, kind: "time", capped: true, rounds: part.round_taps.length, reps: Math.max(0, partialReps) };
      return { ...base, kind: "time", time_seconds: Math.floor(partElapsedMs(part, block, now) / 1000) };
    }
    case "emom": case "work_rest": {
      const reps = mine.filter((a) => a.completed).reduce((sum, a) => sum + (a.reps ?? 0), 0);
      return reps > 0 ? { ...base, kind: "reps", reps } : { ...base, kind: "completed" };
    }
    default: {
      // Strength: the heaviest completed set, in its own unit.
      const heaviest = mine.filter((a) => a.completed && a.load != null && a.load_unit)
        .sort((x, y) => toKg(y.load!, y.load_unit!) - toKg(x.load!, x.load_unit!))[0];
      return heaviest ? { ...base, kind: "load", load: heaviest.load!, load_unit: heaviest.load_unit! } : { ...base, kind: "completed" };
    }
  }
}
const toKg = (load: number, unit: "kg" | "lb") => (unit === "lb" ? load / 2.20462 : load);
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
/** "3 + 12", "8:42", "Capped · 2 + 14", "Buy-in · 600 m", "100 kg". */
export function formatPartScore(result: PartResult) {
  switch (result.kind) {
    case "rounds_reps":
      return result.buy_in_done === false ? `Buy-in · ${result.distance_meters ?? 0} m` : `${result.rounds ?? 0} + ${result.reps ?? 0}`;
    case "time":
      return result.capped ? `Capped · ${result.rounds ?? 0} + ${result.reps ?? 0}` : clockText(result.time_seconds ?? 0);
    case "load": return `${result.load} ${result.load_unit}`;
    case "reps": return `${result.reps} reps`;
    case "distance": return `${result.distance_meters} m`;
    case "calories": return `${result.calories} cal`;
    default: return "Done";
  }
}

/** One split in the API's `Segment` shape (W2). */
export interface Segment {
  block_id: string; kind: "buy_in" | "round" | "run" | "station" | "rest" | "part"; index: number; label?: string;
  started_at: string; ended_at: string; distance_meters?: number;
  run_environment?: RunEnvironment; distance_source?: "gps" | "prescribed" | "edited";
}
/**
 * Splits for an AMRAP or for-time part: the buy-in, then each round. A run's Outdoor/Treadmill choice goes on
 * the buy-in split, or on each round containing that run; treadmill keeps the prescribed or edited distance.
 * Outdoor distance comes later from the watch's GPS, so it is left out here.
 */
export function partSegments(block: Block, part: PartRun): Segment[] {
  const byInterval = part.kind === "emom" && !!intervalRounds(block);
  if (part.started_at == null || part.skipped || (part.kind !== "amrap" && part.kind !== "for_time" && !byInterval)) return [];
  const iso = (at: number) => new Date(at).toISOString();
  const runFields = (index: number) => {
    const choice = part.runs?.[index];
    if (index < 0 || !choice) return {};
    const prescribed = block.exercises[index].distance_meters ?? undefined;
    if (choice.environment === "outdoor") return { run_environment: "outdoor" as const };
    const distance = choice.distance_meters ?? prescribed;
    return { run_environment: "treadmill" as const,
      ...(distance != null ? { distance_meters: distance, distance_source: choice.distance_meters != null && choice.distance_meters !== prescribed ? "edited" as const : "prescribed" as const } : {}) };
  };
  const segments: Segment[] = [];
  let from = part.started_at;
  const buyInIndex = buyIn(block);
  if (buyInIndex >= 0 && part.buy_in_done_at != null) {
    segments.push({ block_id: block.id, kind: "buy_in", index: 1, label: block.exercises[buyInIndex].name,
      started_at: iso(from), ended_at: iso(part.buy_in_done_at), ...runFields(buyInIndex) });
    from = part.buy_in_done_at;
  }
  const roundRun = block.exercises.findIndex((e, i) => i !== buyInIndex && e.segment == null && isRun(e) && part.runs?.[i]);
  const roundRunFields = roundRun >= 0 ? runFields(roundRun) : {};
  if (byInterval) {
    // Each round runs from its interval's start; its index is the interval it was done in.
    for (const at of part.round_taps) {
      const { index, started } = intervalAt(part, block, at);
      segments.push({ block_id: block.id, kind: "round", index, started_at: iso(started), ended_at: iso(at), ...roundRunFields });
    }
    return segments;
  }
  part.round_taps.forEach((at, i) => {
    segments.push({ block_id: block.id, kind: "round", index: i + 1, started_at: iso(from), ended_at: iso(at), ...roundRunFields });
    from = at;
  });
  return segments;
}

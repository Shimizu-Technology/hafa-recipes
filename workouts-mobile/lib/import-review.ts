import type { AuthoredWorkout, Workout } from "./models";
import { workoutProblems } from "./library";
import { isISODate } from "./sharing";
import { ROTATION_CHOICE_MESSAGE, timedBlock } from "./amrap-editor";
import { isTimedFormat } from "./timed-execution";

type Block = Workout["blocks"][number];

/** "Part C" for a part labelled "C. Accessories", otherwise the part's own label. */
export function partName(block: Pick<Block, "label">, index: number) {
  const letter = block.label.match(/^\s*([A-Z])\s*[.:)-]/)?.[1];
  return letter ? `Part ${letter}` : block.label.trim() || `Part ${index + 1}`;
}

/** The interval word for an EMOM: "minute" for 60 seconds, otherwise "interval". */
export const intervalWord = (block: Block) => (block.execution?.mode === "emom" && block.execution.interval_seconds === 60 ? "minute" : "interval");

/**
 * "Minute 1 … Minute N" rows, one move each, say the moves take turns. Read from the part's own wording: its
 * notes, each move's note and each move's name (the source often stores a "Minute 3" header there).
 */
export function inferRotation(block: Block): "alternating" | null {
  if (block.execution?.mode !== "emom" || block.exercises.length < 2) return null;
  const words = [...(block.instructions ?? []), ...block.exercises.flatMap(e => [e.name, e.instructions ?? ""])];
  const minutes = new Set<number>();
  for (const word of words)
    for (const match of word.matchAll(/\bmin(?:ute)?s?\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi)) {
      const from = Number(match[1]), to = match[2] ? Number(match[2]) : from;
      // A header such as "Minutes 1 - 2" names every minute it covers, but a stray "every 3 minutes" does not.
      if (to >= from && to - from < 100) for (let n = from; n <= to; n++) minutes.add(n);
    }
  return minutes.size >= 2 && minutes.size >= block.exercises.length ? "alternating" : null;
}

/** The workout as it will be saved: a rotation the source makes plain is chosen, so Save is never blocked by it. */
export function withReviewDefaults(workout: AuthoredWorkout): AuthoredWorkout;
export function withReviewDefaults(workout: AuthoredWorkout | null | undefined): AuthoredWorkout | null | undefined;
export function withReviewDefaults(workout: AuthoredWorkout | null | undefined) {
  const unset = (block: Block) => block.execution?.mode === "emom" && block.execution.rotation == null && !!inferRotation(block);
  if (!workout?.blocks.some(unset)) return workout;
  return { ...workout, blocks: workout.blocks.map(block => unset(block)
    ? { ...block, execution: { ...block.execution!, rotation: "alternating" as const } } as Block : block) };
}

export interface ReviewProblem {
  key: string;
  message: string;
  /** The part it belongs to; null for the class date or the workout as a whole. */
  blockId: string | null;
  /** The part's name, for the banner and the part's own card. */
  part: string | null;
  scope: "date" | "part" | "workout";
  /** The one-tap control on the part that resolves it, when there is one. */
  fix?: "rotation";
}
/** Everything that stops Save, each tied to its part. Order follows the screen: date, workout, then parts top to bottom. */
export function reviewProblems(input: AuthoredWorkout, options: { allowIncomplete?: boolean; hasExercises?: boolean; isClass?: boolean } = {}): ReviewProblem[] {
  // What Save would send, so a default the source makes plain is never reported as a problem.
  const workout = withReviewDefaults(input);
  const found: ReviewProblem[] = [];
  const hasExercises = options.hasExercises ?? workout.blocks.some(block => block.exercises.length);
  if (options.isClass && workout.programming?.date && !isISODate(workout.programming.date))
    found.push({ key: "date", message: "Choose the class date.", blockId: null, part: null, scope: "date" });
  const raw = hasExercises ? workoutProblems(workout, options.allowIncomplete) : [{ message: "Add at least one exercise before saving this workout." }];
  raw.forEach((problem, index) => {
    const at = problem.blockId ? workout.blocks.findIndex(block => block.id === problem.blockId) : -1;
    found.push({ key: `${problem.blockId ?? "workout"}:${index}`, message: problem.message, blockId: at >= 0 ? problem.blockId! : null,
      part: at >= 0 ? partName(workout.blocks[at], at) : null, scope: at >= 0 ? "part" : "workout",
      ...(at >= 0 && problem.message === ROTATION_CHOICE_MESSAGE ? { fix: "rotation" as const } : {}) });
  });
  const order = (problem: ReviewProblem) => problem.scope === "date" ? -2 : problem.scope === "workout" ? -1 : workout.blocks.findIndex(block => block.id === problem.blockId);
  return found.map((problem, index) => ({ problem, index })).sort((a, b) => order(a.problem) - order(b.problem) || a.index - b.index).map(item => item.problem);
}
/** One line for the banner: how many things need a fix, and the first one by name. */
export function problemSummary(problems: ReviewProblem[]) {
  if (!problems.length) return "";
  const first = problems[0];
  const lead = problems.length === 1 ? "One thing to fix before saving" : `${problems.length} things to fix before saving`;
  return `${lead}. ${first.part ? `${first.part}: ` : ""}${first.message}`;
}

export interface ReviewNotice { text: string; blockId: string | null; part: string | null; kind: "check" | "info"; /** The text already names its part, so a part prefix would repeat it. */ named?: boolean }
/** A notice that only says what was left out, with nothing to check. */
const informational = (text: string) => /\b(removed|left out|truncated|unavailable)\b/i.test(text) && !/\b(review|check|needs|confirm)\b/i.test(text);
/**
 * The API's warnings as short items. Each is linked to its part when it names one ("Part C …", "B. Every 3 minutes: …",
 * or a move that appears in a single part); purely informational ones are marked so the screen can keep them quiet.
 */
export function reviewNotices(warnings: readonly string[], workout: AuthoredWorkout | null | undefined): ReviewNotice[] {
  const blocks = workout?.blocks ?? [];
  const seen = new Set<string>();
  const notices: ReviewNotice[] = [];
  for (const text of warnings.map(warning => warning.trim()).filter(Boolean)) {
    if (seen.has(text)) continue;
    seen.add(text);
    const letter = text.match(/\bPart\s+([A-Z])\b/)?.[1];
    let at = letter ? blocks.findIndex(block => new RegExp(`^\\s*${letter}\\s*[.:)-]`).test(block.label)) : -1;
    if (at < 0) at = blocks.findIndex(block => block.label.trim().length >= 3 && text.toLowerCase().includes(block.label.trim().toLowerCase()));
    if (at < 0) {
      const named = blocks.map((block, index) => ({ index, hit: block.exercises.some(e => e.name.trim().length >= 4 && text.toLowerCase().includes(e.name.trim().toLowerCase())) })).filter(item => item.hit);
      if (named.length === 1) at = named[0].index;
    }
    const named = at >= 0 && (/^Part\s+[A-Z]\b/.test(text) || text.toLowerCase().startsWith(blocks[at].label.trim().toLowerCase()));
    notices.push({ text, blockId: at >= 0 ? blocks[at].id : null, part: at >= 0 ? partName(blocks[at], at) : null, kind: informational(text) ? "info" : "check", ...(named ? { named } : {}) });
  }
  return notices;
}

/** Whether the part counts rounds, so its count can be set (or noticed missing) right on the part. */
export const wantsRounds = (block: Block) => block.grouping !== "sequential" && block.execution?.mode !== "amrap" && !timedBlock(block);
/** Whether a one-tap alternate/every-move choice belongs on this part. */
export const wantsRotation = (block: Block) => isTimedFormat(block.execution) && block.execution.mode === "emom" && block.exercises.length > 1;

/** Sets a part's rounds (1–100), or clears them with null. */
export function setPartRounds(workout: AuthoredWorkout, blockId: string, rounds: number | null): AuthoredWorkout {
  return { ...workout, blocks: workout.blocks.map(block => block.id === blockId ? { ...block, rounds } : block) };
}
/** Sets how an EMOM part's moves rotate. */
export function setPartRotation(workout: AuthoredWorkout, blockId: string, rotation: "alternating" | "together"): AuthoredWorkout {
  return { ...workout, blocks: workout.blocks.map(block => block.id === blockId && block.execution?.mode === "emom"
    ? { ...block, execution: { ...block.execution, rotation } } : block) };
}

/** What to paste to try again, worded for the kind of source that was read. */
export function retryHelp(kind: "url" | "text" | "images" | "document" | undefined, isClass: boolean) {
  const what = isClass ? "the class instructions" : "the creator’s caption or instructions";
  const read = kind === "images" ? (isClass ? "screenshots" : "images") : kind === "document" ? "PDF" : kind === "text" ? "text" : kind === "url" ? "video or page" : "source";
  const tail = kind === "text" ? "if something was missed" : `if the ${read} could not be read`;
  return `Paste ${what}${kind === "text" ? " again" : ""} ${tail}. This creates a separate private import. Your saved workouts stay unchanged.`;
}

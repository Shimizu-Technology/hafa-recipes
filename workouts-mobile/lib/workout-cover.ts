import type { FormatBlock } from "./timed-execution";
import { formatSeconds } from "./discover";
import { formatLabel } from "./timed-execution";
import { formatNumeral } from "./format-numeral";

/** Covers use prescriptions, never guesses from a workout title. */
export function workoutCover(blocks: FormatBlock[] | undefined, meta: string) {
  const block = blocks?.length === 1 ? blocks[0] : undefined;
  const execution = block?.execution;
  if (execution?.mode === "work_rest") {
    const tabata = execution.work_seconds === 20 && execution.rest_seconds === 10 && execution.intervals === 8;
    return { headline: tabata ? "TABATA" : "INTERVALS", caption: [
      execution.intervals != null ? `${execution.intervals} rounds` : null,
      `${execution.work_seconds}s work / ${execution.rest_seconds}s rest`,
    ].filter(Boolean).join(" · ") };
  }
  if (execution?.mode === "for_time") return { headline: "FOR TIME", caption: [
    block?.rounds != null ? `${block.rounds} rounds` : null,
    execution.time_cap_seconds != null ? `${formatSeconds(execution.time_cap_seconds)} cap` : null,
  ].filter(Boolean).join(" · ") || "No time cap" };
  if (execution) {
    const label = formatLabel(block!) ?? meta;
    const { numeral, caption } = formatNumeral(label.toUpperCase());
    return { headline: numeral ?? caption, caption: numeral ? caption : "" };
  }
  if (blocks?.length) return {
    headline: blocks.some(b => b.exercises.some(e => (e.sets ?? 0) > 0)) ? "STRENGTH" : "CUSTOM",
    caption: meta.toUpperCase(),
  };
  const { numeral, caption } = formatNumeral(meta.toUpperCase());
  return { headline: numeral ?? (caption || "CUSTOM"), caption: numeral ? caption : "" };
}

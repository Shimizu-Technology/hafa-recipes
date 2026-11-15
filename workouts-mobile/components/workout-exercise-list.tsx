import { Fragment } from "react";
import { Copy, ListGroup, ListRow } from "@/components/ui";
import { blockSummary, timedBlock } from "@/lib/amrap-editor";
import { formatSeconds, prescriptionLine } from "@/lib/discover";
import { partTags, relativeLoadSuggestion, restAfterText, segmentLabel } from "@/lib/class-parts";
import type { Workout } from "@/lib/models";
import type { UnitSystem } from "@/lib/training";

/** Each part with its moves. `weightKg` turns a %-bodyweight load into a suggested weight. */
export function WorkoutExerciseList({ blocks, formatChip, weightKg, units = "metric" }: {
  blocks: Workout["blocks"]; formatChip: string | null; weightKg?: number | null; units?: UnitSystem;
}) {
  return blocks.map((block, index) => {
    if (!block.exercises.length) return null;
    const said = blocks.length === 1 && formatChip ? formatChip : "";
    const caption = [
      block.label && block.label.trim().toLowerCase() !== said.toLowerCase() ? block.label : null,
      ...partTags(block),
      blockSummary(block, [block.label, said].filter(Boolean).join(" ")),
      block.rounds == null && block.grouping !== "sequential" && !timedBlock(block) ? "Rounds not specified" : null,
      block.rest_between_rounds_seconds != null ? `${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : null,
    ].filter(Boolean).join(" · ");
    const rest = restAfterText(block);
    // Buy-ins and cash-outs happen once, so only the repeating moves are numbered.
    let number = 0;
    // Coach notes come before the moves, as the gym writes them; the rest to the next part comes after.
    return <Fragment key={index}>
      {block.instructions?.map((line, i) => <Copy key={i} kind="small" tone="muted">{line}</Copy>)}
      <ListGroup header={caption} separatorInset={38}>
      {block.exercises.map((exercise, i) => {
        const once = segmentLabel(exercise);
        if (!once) number++;
        return <ListRow key={i} leading={once ? "•" : String(number)} title={exercise.name}
          detail={[[once, prescriptionLine(exercise)].filter(Boolean).join(" · "), relativeLoadSuggestion(exercise, weightKg, units),
            exercise.instructions, exercise.notes ? `Private note · ${exercise.notes}` : null].filter(Boolean).join("\n")} />;
      })}
      </ListGroup>
      {!!rest && <Copy kind="small" tone="accent" align="center">{rest}, then {blocks[index + 1]?.label ?? "the next part"}</Copy>}
    </Fragment>;
  });
}

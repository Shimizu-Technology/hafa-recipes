import { ListGroup, ListRow } from "@/components/ui";
import { blockSummary, timedBlock } from "@/lib/amrap-editor";
import { formatSeconds, prescriptionLine } from "@/lib/discover";
import type { Workout } from "@/lib/models";

export function WorkoutExerciseList({ blocks, formatChip }: { blocks: Workout["blocks"]; formatChip: string | null }) {
  return blocks.map((block, index) => {
    if (!block.exercises.length) return null;
    const said = blocks.length === 1 && formatChip ? formatChip : "";
    const caption = [
      block.label && block.label.trim().toLowerCase() !== said.toLowerCase() ? block.label : null,
      blockSummary(block, [block.label, said].filter(Boolean).join(" ")),
      block.rounds == null && block.grouping !== "sequential" && !timedBlock(block) ? "Rounds not specified" : null,
      block.rest_between_rounds_seconds != null ? `${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : null,
    ].filter(Boolean).join(" · ");
    return <ListGroup key={index} header={caption} separatorInset={38}>
      {block.exercises.map((exercise, i) => <ListRow key={i} leading={String(i + 1)} title={exercise.name}
        detail={[prescriptionLine(exercise), exercise.instructions, exercise.notes ? `Private note · ${exercise.notes}` : null].filter(Boolean).join("\n")} />)}
    </ListGroup>;
  });
}

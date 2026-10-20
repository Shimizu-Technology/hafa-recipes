import { blockSummary } from "./amrap-editor";
import { creatorCredit, formatSeconds, prescriptionLine, type DiscoverDetail } from "./discover";
import { workoutMeta } from "./plan-presentation";

/** Plain-text copy of a Discover workout for the system share sheet. Public fields only. */
export function discoverShareText(item: DiscoverDetail) {
  const credit = creatorCredit(item);
  const lines = [
    item.title,
    workoutMeta({
      minutes: item.estimated_minutes,
      exercises: item.exercise_count,
      equipment: item.equipment_required.length ? item.equipment_required : ["No equipment"],
    }),
  ];
  item.workout.blocks.forEach((block, index) => {
    lines.push(
      "",
      [
        block.label || `Block ${index + 1}`,
        blockSummary(block, block.label),
        block.rest_between_rounds_seconds ? `${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    );
    block.exercises.forEach((exercise, i) => lines.push(`${i + 1}. ${exercise.name}: ${prescriptionLine(exercise)}`));
  });
  lines.push("");
  if (credit) lines.push(`Original by ${credit}${item.source_url ? `: ${item.source_url}` : ""}`);
  else if (item.source_url) lines.push(`Original: ${item.source_url}`);
  lines.push("Found on Håfa Workouts");
  return lines.join("\n");
}

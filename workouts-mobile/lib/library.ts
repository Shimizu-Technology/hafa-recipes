import type { Workout, AuthoredWorkout } from "./models";
import { authoredWorkout } from "./api";
export function editedContent(workout: Workout | AuthoredWorkout): AuthoredWorkout {
  const content = authoredWorkout(workout);
  return {
    ...content,
    provenance: content.provenance === "suggestion" ? "user" : content.provenance,
    blocks: content.blocks.map((block) => ({
      ...block,
      exercises: block.exercises.map((e) => (e.provenance === "suggestion" ? { ...e, provenance: "user" } : e)),
    })),
  };
}
export function workoutErrors(workout: AuthoredWorkout,allowIncomplete=false) {
  const errors: string[] = [];
  if (!workout.title.trim() || workout.title.length > 200) errors.push("Use a workout title from 1 to 200 characters.");
  if (!workout.blocks.length && !allowIncomplete) errors.push("Add at least one workout block.");
  for (const block of workout.blocks) {
    if (!block.label.trim()) errors.push("Name each workout block.");
    if (block.rounds != null && (!Number.isInteger(block.rounds) || block.rounds < 1 || block.rounds > 100))
      errors.push("Rounds must be a whole number from 1 to 100.");
    for (const e of block.exercises) {
      if (!e.name.trim()) errors.push("Name each exercise.");
      if (e.reps_min != null && e.reps_max != null && e.reps_min > e.reps_max)
        errors.push(`${e.name}: minimum reps cannot exceed maximum reps.`);
      if (e.sets != null && (!Number.isInteger(e.sets) || e.sets < 1 || e.sets > 100))
        errors.push(`${e.name}: sets must be 1 through 100.`);
      if (e.load != null && (!Number.isFinite(e.load) || e.load < 0 || !e.load_unit || !e.load_convention))
        errors.push(`${e.name}: load needs a valid value, unit and convention.`);
      for (const value of [e.reps_min, e.reps_max, e.duration_seconds, e.rest_seconds])
        if (value != null && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)))
          errors.push(`${e.name}: reps, seconds and rest need whole numbers.`);
      if([e.reps_min,e.reps_max].some(v=>v!=null && (v<1||v>1000)))errors.push(`${e.name}: reps must be from 1 to 1000, or blank.`);
      if(e.duration_seconds!=null && (e.duration_seconds<1||e.duration_seconds>86400))errors.push(`${e.name}: timed targets must be from 1 to 86400 seconds, or blank.`);
      if(e.distance_meters!=null && (!Number.isFinite(e.distance_meters)||e.distance_meters<=0||e.distance_meters>1000000))errors.push(`${e.name}: enter a positive distance in metres, or leave it blank.`);
      if(e.rest_seconds!=null && e.rest_seconds>7200)errors.push(`${e.name}: rest must be no more than 7200 seconds.`);
    }
  }
  return [...new Set(errors)];
}
export function filterLibrary(workouts: Workout[], search: string, equipment: string | null, kind: string | null) {
  const needle = search.toLocaleLowerCase().trim();
  return workouts.filter(
    (w) =>
      (!needle ||
        [w.title, ...w.blocks.flatMap((b) => b.exercises.map((e) => e.name)), ...(w.equipment_required ?? [])]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle)) &&
      (!equipment || (w.equipment_required ?? []).includes(equipment)) &&
      (!kind || w.kind === kind)
  );
}

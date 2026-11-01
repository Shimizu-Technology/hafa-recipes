import type { Workout, AuthoredWorkout } from "./models";
import { authoredWorkout } from "./api";
import { executionError } from "./amrap-editor";
export function editedContent(workout: Workout | AuthoredWorkout): AuthoredWorkout {
  const content = authoredWorkout(workout);
  return {
    ...content,
    // Keep unfinished words and blank next lines in the controlled editor.
    // The transport boundary normalizes instructions before saving.
    notes: workout.notes,
    instructions: workout.instructions,
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
  if (workout.estimated_minutes != null && (!Number.isInteger(workout.estimated_minutes) || workout.estimated_minutes < 1 || workout.estimated_minutes > 1440))
    errors.push("Estimated duration must be whole minutes from 1 to 1440, or blank.");
  if ((workout.instructions ?? []).filter(line => line.trim()).length > 100)
    errors.push("Keep workout instructions to 100 lines or fewer.");
  if ((workout.instructions ?? []).some(line => line.length > 4000))
    errors.push("Keep each workout instruction within 4000 characters.");
  if ((workout.notes ?? []).filter(note => note.trim()).length > 100)
    errors.push("Keep private notes to 100 lines or fewer.");
  if ((workout.notes ?? []).some(note => note.length > 4000))
    errors.push("Keep each private note within 4000 characters.");
  if ((workout.equipment_required?.length ?? 0) > 100 || (workout.equipment_optional?.length ?? 0) > 100)
    errors.push("Keep each equipment list to 100 items or fewer.");
  if ([...(workout.equipment_required ?? []), ...(workout.equipment_optional ?? [])].some(item => item.length > 4000))
    errors.push("Keep each equipment item within 4000 characters.");
  if (!workout.blocks.length && !allowIncomplete) errors.push("Add at least one workout block.");
  if (workout.blocks.length > 100) errors.push("Use 100 workout blocks or fewer.");
  for (const block of workout.blocks) {
    const executionProblem = executionError(block);
    if (executionProblem) errors.push(executionProblem);
    if (!block.label.trim()) errors.push("Name each workout block.");
    if (block.label.length > 200) errors.push("Keep block names within 200 characters.");
    if (block.exercises.length > 100) errors.push(`${block.label}: use 100 exercises or fewer.`);
    if (block.rounds != null && (!Number.isInteger(block.rounds) || block.rounds < 1 || block.rounds > 100))
      errors.push("Rounds must be a whole number from 1 to 100.");
    if (block.rest_between_rounds_seconds != null && (!Number.isInteger(block.rest_between_rounds_seconds) || block.rest_between_rounds_seconds < 0 || block.rest_between_rounds_seconds > 7200))
      errors.push("Rest between rounds must be whole seconds from 0 to 7200, or blank.");
    for (const e of block.exercises) {
      if (!e.name.trim()) errors.push("Name each exercise.");
      if (e.name.length > 200) errors.push("Keep exercise names within 200 characters.");
      if ((e.tempo?.length ?? 0) > 100) errors.push(`${e.name}: keep tempo within 100 characters.`);
      if ((e.effort?.length ?? 0) > 500) errors.push(`${e.name}: keep effort within 500 characters.`);
      if ((e.instructions?.length ?? 0) > 2000) errors.push(`${e.name}: keep instructions or cues within 2000 characters.`);
      if ((e.notes?.length ?? 0) > 2000) errors.push(`${e.name}: keep private notes within 2000 characters.`);
      if (e.reps_min != null && e.reps_max != null && e.reps_min > e.reps_max)
        errors.push(`${e.name}: minimum reps cannot exceed maximum reps.`);
      if (e.rep_scheme != null && (e.rep_scheme.length < 2 || e.rep_scheme.length > 100 || e.rep_scheme.some((n) => !Number.isInteger(n) || n < 1 || n > 1000)))
        errors.push(`${e.name}: reps per round need 2 to 100 whole numbers from 1 to 1000.`);
      if (e.ladder != null && (!Number.isInteger(e.ladder.start) || e.ladder.start < 1 || e.ladder.start > 1000 ||
        !Number.isInteger(e.ladder.step) || !e.ladder.step || Math.abs(e.ladder.step) > 100 ||
        (e.ladder.end != null && (!Number.isInteger(e.ladder.end) || e.ladder.end < 1 || e.ladder.end > 1000))))
        errors.push(`${e.name}: check the rep ladder.`);
      if (e.sets != null && (!Number.isInteger(e.sets) || e.sets < 1 || e.sets > 100))
        errors.push(`${e.name}: sets must be 1 through 100.`);
      if (e.load != null && (!Number.isFinite(e.load) || e.load < 0 || !e.load_unit || !e.load_convention))
        errors.push(`${e.name}: load needs a valid value, unit and convention.`);
      if (e.load != null && e.load > 2000) errors.push(`${e.name}: load must be no more than 2000.`);
      for (const value of [e.reps_min, e.reps_max, e.duration_seconds, e.rest_seconds])
        if (value != null && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)))
          errors.push(`${e.name}: reps, seconds and rest need whole numbers.`);
      if([e.reps_min,e.reps_max].some(v=>v!=null && (v<1||v>1000)))errors.push(`${e.name}: reps must be from 1 to 1000, or blank.`);
      if(e.duration_seconds!=null && (e.duration_seconds<1||e.duration_seconds>86400))errors.push(`${e.name}: timed targets must be from 1 to 86400 seconds, or blank.`);
      if(e.distance_meters!=null && (!Number.isFinite(e.distance_meters)||e.distance_meters<=0||e.distance_meters>1000000))errors.push(`${e.name}: enter a distance above zero, or leave it blank.`);
      if(e.rest_seconds!=null && e.rest_seconds>7200)errors.push(`${e.name}: rest must be no more than 7200 seconds.`);
    }
  }
  // Include the server's expanded empty fields before freezing a creation command.
  // Pretty JSON also reserves space for its separators and record metadata.
  const expanded = { instructions: [], notes: [], ...workout, blocks: workout.blocks.map(block => ({
    rounds: null, rest_between_rounds_seconds: null, evidence: [], ...block,
    exercises: block.exercises.map(exercise => ({
      exercise_id: null, provenance: "user", sets: null, reps_min: null, reps_max: null, per_side: null,
      duration_seconds: null, distance_meters: null, rest_seconds: null, tempo: null, load: null,
      load_unit: null, load_convention: null, effort: null, instructions: null, notes: null, evidence: [], ...exercise,
    })),
  })) };
  if (new TextEncoder().encode(JSON.stringify(expanded, null, 1)).byteLength > 240 * 1024 - 1024)
    errors.push("This workout is too large to save. Shorten its instructions or split it into smaller workouts.");
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

import type { AuthoredWorkout } from "./models";
export interface ExerciseDraft {
  name: string;
  sets: string;
  reps: string;
}
export interface WorkoutDraft {
  creation_key?: string;
  generation?: number;
  title: string;
  equipment: string;
  exercises: ExerciseDraft[];
}
export const blankWorkout = (): WorkoutDraft => ({
  title: "",
  equipment: "",
  exercises: [{ name: "", sets: "", reps: "" }],
});
export function manualWorkout(draft: WorkoutDraft): AuthoredWorkout {
  if (!draft.title.trim()) throw new Error("Give your workout a name.");
  if (!draft.exercises.length || draft.exercises.some((e) => !e.name.trim()))
    throw new Error("Name each exercise, or remove the empty row.");
  const integer = (value: string, label: string, max = 1000) => {
    if (!value.trim()) return null;
    if (!/^\d+$/.test(value.trim()) || Number(value) < 1 || Number(value) > max)
      throw new Error(`${label} must be a whole number between 1 and ${max}, or left blank.`);
    return Number(value);
  };
  return {
    title: draft.title.trim(),
    kind: "session",
    provenance: "user",
    equipment_required: draft.equipment
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    blocks: [
      {
        id: "main",
        label: "Main session",
        grouping: "sequential",
        exercises: draft.exercises.map((e) => ({
          name: e.name.trim(),
          sets: integer(e.sets, "Sets", 100),
          reps_min: integer(e.reps, "Reps"),
          reps_max: integer(e.reps, "Reps"),
        })),
      },
    ],
  };
}

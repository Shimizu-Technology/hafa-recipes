import type { Workout } from "../models";

export const intervalClass: Workout = {
  id: "interval-class", generation: 1, revision: 1, title: "Intervals", provenance: "user", kind: "session",
  blocks: [{
    id: "a", label: "A", grouping: "interval", rest_after_seconds: 60,
    execution: { mode: "emom", interval_seconds: 360, intervals: 3, rotation: "together" },
    exercises: [{ name: "Sled push", distance_meters: 25 }, { name: "Run", distance_meters: 400 },
      { name: "Farmer’s carry", distance_meters: 100, reps_min: 1 }],
  }, {
    id: "b", label: "B", grouping: "interval", score_kind: "none",
    execution: { mode: "emom", interval_seconds: 60, intervals: 1, rotation: null },
    exercises: [{ name: "Burpee", reps_min: 10 }],
  }],
};

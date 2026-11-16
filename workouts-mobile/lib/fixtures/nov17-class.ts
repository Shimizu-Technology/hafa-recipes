/** The Nov 17 Unified class (BUILD | BRIK, HYBRID) from design §1.4, the same JSON as the API fixture. Test-only. */
import type { Workout } from "../models";

const source = {
  "title": "BUILD | BRIK · Tue Nov 17",
  "kind": "session",
  "provenance": "source",
  "capture_kind": "text",
  "programming": { "source_kind": "gym", "app_name": "WodUp", "gym_name": "Unified",
                   "track": "BUILD | BRIK", "track_variant": "HYBRID", "date": "2026-11-17" },
  "benchmark": { "key": "everest", "name": "Everest", "stage": 2, "stages": 3, "block_ids": ["a", "b"] },
  "instructions": [
    "Progression 2/3 for benchmark \"Everest\".",
    "Hold a pace you can repeat in B.",
    "Deadlifts unbroken at 75% bodyweight.",
    "1000 m buy-in under 6:30."
  ],
  "blocks": [
    { "id": "a", "label": "A", "role": "main", "grouping": "circuit",
      "execution": { "mode": "amrap", "time_cap_seconds": 900 },
      "rest_after_seconds": 180,
      "exercises": [
        { "name": "Run", "segment": "buy_in", "distance_meters": 1000, "distance_meters_min": 800,
          "effort": "Under 6:30" },
        { "name": "Deadlift", "reps_min": 15, "reps_max": 15,
          "relative_load": { "basis": "bodyweight", "percent": 75 }, "instructions": "Unbroken" },
        { "name": "Burpee", "reps_min": 20, "reps_max": 20 },
        { "name": "Run", "distance_meters": 400, "distance_meters_min": 300 }
      ] },
    { "id": "b", "label": "B", "role": "main", "grouping": "circuit",
      "execution": { "mode": "amrap", "time_cap_seconds": 900 },
      "exercises": [
        { "name": "Run", "segment": "buy_in", "distance_meters": 1000, "distance_meters_min": 800 },
        { "name": "Wall Ball", "reps_min": 30, "reps_max": 30,
          "load_options": [ { "load": 20, "load_unit": "lb" }, { "load": 14, "load_unit": "lb" } ] },
        { "name": "Burpee", "reps_min": 20, "reps_max": 20 },
        { "name": "Run", "distance_meters": 400, "distance_meters_min": 300 }
      ] },
    { "id": "c", "label": "C", "role": "cool_down", "score_kind": "none", "grouping": "sequential",
      "instructions": ["Active recovery."],
      "exercises": [
        { "name": "Bike Erg", "duration_seconds": 600, "effort": "Easy",
          "instructions": "Low damper. Nasal breathing only." }
      ] },
    { "id": "d", "label": "D", "role": "accessory", "score_kind": "none", "grouping": "superset", "rounds": 2,
      "exercises": [
        { "name": "GHD side-lying Pallof hold", "duration_seconds": 30, "duration_seconds_max": 40, "rest_seconds": 30 },
        { "name": "Cable Cuban press", "reps_min": 10, "reps_max": 12, "tempo": "3010",
          "effort": "RIR 2-3", "rest_seconds": 30 },
        { "name": "Incline side-lying DB Powell raise", "reps_min": 10, "reps_max": 12, "rest_seconds": 30 }
      ] }
  ]
};

export const nov17Class: Workout = { id: "nov17", revision: 1, generation: 1, ...(source as Omit<Workout, "id" | "revision" | "generation">) };

import { authoredWorkout } from "./api";
import type { AuthoredWorkout, Workout } from "./models";
import type { SavedLocalSession } from "./training";

export interface ResultRecoveryCommand { creation_key: string; client_session_id: string }
export interface ResultRecoveryReceipt extends ResultRecoveryCommand { original_id: string; saved_id: string }
export function canRecoverResult(item: SavedLocalSession) {
  return item.state === "blocked" && [404, 410].includes(item.rejection_status ?? 0) &&
    !item.request.supersedes_session_id;
}
/** A reviewed local copy is user-authored; it cannot claim server/source evidence. */
export function restoredPrescription(workout: Workout): AuthoredWorkout {
  return { ...authoredWorkout(workout), provenance: "user", source_thumbnail_url: null,
    blocks: workout.blocks.map(block => ({ ...block, evidence: [], exercises: block.exercises.map(exercise => ({
      ...exercise, provenance: "user", evidence: [],
    })) })) };
}

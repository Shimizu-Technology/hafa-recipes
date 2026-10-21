import type { CoachAction, CoachFocus } from "./coach";
import type { TrainingProfile } from "./models";

// Exact legacy API strings also cover suggestions saved by earlier app builds.
const profileGate = "Confirm adult eligibility/readiness and resolve any free-text restrictions before personal adaptation.";
const movementsGate = "Select recognized movement exclusions before adapting this workout.";
const equipmentGate = "Confirm available equipment, including any stable supports or anchors.";
export function coachReturnParams(focus: CoachFocus) {
  return {
    ...(focus.context_workout_id ? { workout_id: focus.context_workout_id } : {}),
    ...(focus.context_program_id ? { program_id: focus.context_program_id } : {}),
    ...(focus.context_session_id ? { session_id: focus.context_session_id } : {}),
    ...(focus.context_revision ? { revision: String(focus.context_revision) } : {}),
  };
}
export function coachRecovery(action: CoachAction, profile: TrainingProfile, revision: number,
  checkIn: { state: string; expires_at: string | null }, now = Date.now()) {
  const questions = action.proposal.questions ?? [];
  const lines: string[] = [];
  let reviewProfile = false;
  if (questions.includes(profileGate)) {
    if (!profile.adult_confirmed) { lines.push("Confirm you are 18 or older in your training profile."); reviewProfile = true; }
    if (profile.limitations.some(value => value.trim())) {
      lines.push("Your saved limitations need review. Keep any instructions you still follow; Coach may be unable to change this workout safely.");
      reviewProfile = true;
    }
  }
  if (questions.includes(equipmentGate) && profile.equipment === null) {
    lines.push("Choose your equipment, or choose Bodyweight / no equipment, in your training profile."); reviewProfile = true;
  }
  if (questions.includes(movementsGate) && revision <= action.profile_revision) {
    lines.push("Review the movements you need to avoid in your training profile. Coach could not match them to known exercises."); reviewProfile = true;
  }
  const other = questions.filter(q => ![profileGate, movementsGate, equipmentGate].includes(q));
  for (const question of other) {
    lines.push(question.startsWith("Review block durations")
      ? "Review this workout’s timing and which exercises can be left out before making it shorter."
      : question.startsWith("How many sets/rounds") ? "This workout is missing the number of sets or rounds. Review its exercise details."
      : question.startsWith("What repetition, time or distance") ? "This workout is missing exercise targets. Review its reps, time or distance."
      : question.startsWith("Confirm the movement/equipment") ? "Coach could not match an exercise to a known movement. Review the workout’s exercises and equipment."
      : question.startsWith("Review timed blocks") ? "Review this workout’s timed sections separately before asking Coach to change them."
      : "Coach needs more details before it can offer a change. Open Details to review what is missing.");
  }
  if (!questions.length) lines.push("Open Details to review what Coach still needs.");
  const ready = checkIn.state === "ready" && !!checkIn.expires_at && Date.parse(checkIn.expires_at) > now;
  if (!ready) lines.push(checkIn.state === "limited"
    ? "Your check-in says you need to take it easier. Keep that choice if it still applies; Coach may be unable to offer this change."
    : "Check in for today so Coach knows how you are feeling. Saving your training profile does not save today’s check-in.");
  const next = reviewProfile ? "profile" : !ready ? "check-in" : other.length || !questions.length ? "details" : "ask";
  if (!lines.length) lines.push("Your saved information is updated. Ask Coach again to prepare a fresh suggestion.");
  return { lines, next, title: next === "profile" ? "Review training profile" : next === "check-in" ? "Check in for today" : next === "details" ? "Review details" : "Ask again" };
}

import type { Program, ScheduledSession, TrainingProfile, Workout } from "./models";
export interface CoachFocus {
  context_workout_id?: string;
  context_program_id?: string;
  context_session_id?: string;
  context_revision?: number;
}
export interface CoachSummary {
  proposal_id: string;
  kind: "program" | "adaptation" | "profile" | "schedule" | "progression";
  status: string;
  state: "proposed" | "accepted" | "undone";
  record_id?: string;
  after_revision?: number;
}
export interface CoachMessage {
  id: string;
  request_id: string;
  generation: number;
  state: "pending" | "completed" | "failed";
  user_message: string;
  assistant_message: string | null;
  actions: CoachSummary[];
  created_at: string;
  focus: CoachFocus;
}
export interface CoachHistory {
  messages: CoachMessage[];
  limit: number;
  offset: number;
}
export interface CoachProposal {
  status: "ready" | "needs_information" | "conflicts" | "unsupported";
  questions?: string[];
  warnings?: string[];
  assumptions?: string[];
  sessions?: ScheduledSession[];
  workout?: Workout;
  profile?: TrainingProfile;
  changes?: Record<string, unknown>;
  program?: {
    title: string;
    proposal: Omit<Program, "id" | "title" | "revision" | "generation" | "schedule_state">;
    schedule_state?: Program["schedule_state"];
  };
  operation?: string;
  session_id?: string;
  session_ids?: string[];
  confirmation_required?: boolean;
  review_notice?: string;
  evaluation?: { reason?: string; [key: string]: unknown };
  notes?: string[];
  rule_version?: string;
  source_ids?: string[];
}
export interface CoachAction {
  id: string;
  kind: CoachSummary["kind"];
  proposal: CoachProposal;
  profile_revision: number;
  target_id: string | null;
  target_revision: number | null;
  expires_at: string;
}
export interface CoachResult {
  proposal_id: string;
  record_id?: string;
  revision?: number;
  state: "accepted" | "undone";
}
export interface PendingCoachMessage {
  request_id: string;
  message: string;
  generation: number;
  focus: CoachFocus;
  created_at: string;
}
export function coachFocusErrors(focus: CoachFocus) {
  const count = [focus.context_workout_id, focus.context_program_id, focus.context_session_id].filter(Boolean).length;
  return count > 1 ||
    (focus.context_revision != null && !focus.context_workout_id && !focus.context_program_id) ||
    (focus.context_revision != null && (!Number.isInteger(focus.context_revision) || focus.context_revision < 1))
    ? ["Choose exactly one valid focus and its original revision."]
    : [];
}
export function needsReturnConfirmation(action: CoachAction) {
  return action.proposal.operation === "return" || action.proposal.confirmation_required === true;
}
export function canAcceptCoach(action: CoachAction, reviewed: boolean, returnConfirmed: boolean, now = Date.now()) {
  return (
    action.proposal.status === "ready" &&
    reviewed &&
    Date.parse(action.expires_at) > now &&
    (!needsReturnConfirmation(action) || returnConfirmed)
  );
}

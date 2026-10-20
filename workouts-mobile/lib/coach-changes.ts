import type { CoachAction } from "./coach";
import { goalLabels, type ExercisePrescription, type Program, type ScheduledSession, type TrainingProfile, type Workout } from "./models";
import { humanize } from "./labels";
import { exerciseTargets, formatPlanDate } from "./plan-presentation";

/** One line of a suggested change: what it is now and what it becomes. */
export interface ChangeRow { label: string; before?: string; after: string }
export interface ChangeSummary { title: string; rows: ChangeRow[]; note?: string }
/** What the change is applied to, read fresh so "before" is today's record. */
export interface ChangeContext { profile?: TrainingProfile | null; workout?: Workout | null; program?: Program | null }

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const fieldLabels: Record<string, string> = {
  primary_goal: "Goal", session_minutes: "Minutes per session", available_days: "Training days",
  "running_baseline.accepted_stage": "Running stage", equipment: "Equipment",
};

export function changeLabel(key: string) {
  return fieldLabels[key] ?? humanize(key);
}
export function changeValue(key: string, value: unknown): string {
  if (value == null) return "Not set";
  if (key === "primary_goal" && typeof value === "string") return goalLabels[value as keyof typeof goalLabels] ?? value;
  if (key === "available_days" && Array.isArray(value)) return value.map(day => days[Number(day)] ?? String(day)).join(", ") || "None";
  if (key === "session_minutes" && typeof value === "number") return `${value} min`;
  if (Array.isArray(value)) return value.join(", ") || "None";
  return String(value);
}
function profileValue(profile: TrainingProfile | null | undefined, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, profile);
}

const exercises = (workout: Workout) => workout.blocks.flatMap(block => block.exercises);
const targets = (e: ExercisePrescription) => exerciseTargets(e);
/** Exercise-level differences, matched by name in order (the coach keeps names when it adjusts targets). */
export function workoutRows(before: Workout | null | undefined, after: Workout): ChangeRow[] {
  const old = before ? exercises(before) : [];
  const rows: ChangeRow[] = [];
  const used = new Set<number>();
  for (const e of exercises(after)) {
    const index = old.findIndex((item, i) => !used.has(i) && item.name === e.name);
    if (index < 0) { rows.push({ label: e.name, before: before ? "Not in this workout" : undefined, after: targets(e) }); continue; }
    used.add(index);
    if (targets(old[index]) !== targets(e)) rows.push({ label: e.name, before: targets(old[index]), after: targets(e) });
  }
  old.forEach((e, i) => { if (!used.has(i)) rows.push({ label: e.name, before: targets(e), after: "Removed" }); });
  if (before && before.estimated_minutes !== after.estimated_minutes && after.estimated_minutes)
    rows.unshift({ label: "Length", before: before.estimated_minutes ? `${before.estimated_minutes} min` : "Not set", after: `${after.estimated_minutes} min` });
  return rows;
}

/** Date and exercise changes for the affected sessions; a change repeated across sessions is listed once. */
function sessionRows(before: ScheduledSession[], after: ScheduledSession[], ids: Set<string>): ChangeRow[] {
  const rows: Array<ChangeRow & { count?: number }> = [];
  const repeats = new Map<string, ChangeRow & { count: number }>();
  for (const id of ids) {
    const was = before.find(item => item.id === id), now = after.find(item => item.id === id);
    const title = (now ?? was)?.workout.title ?? "Session";
    if (was && !now) rows.push({ label: title, before: formatPlanDate(was.date), after: "Skipped" });
    else if (now && was && was.date !== now.date) rows.push({ label: title, before: formatPlanDate(was.date), after: formatPlanDate(now.date) });
    if (now && was) for (const row of workoutRows(was.workout, now.workout)) {
      const label = `${title} · ${row.label}`, key = JSON.stringify([label, row.before, row.after]);
      const seen = repeats.get(key);
      if (seen) seen.count++;
      else { const entry = { ...row, label, count: 1 }; repeats.set(key, entry); rows.push(entry); }
    }
  }
  return rows.map(({ count = 1, ...row }) => count > 1 ? { ...row, label: `${row.label} (${count} sessions)` } : row);
}

/** Plain-language "before → after" for a coach suggestion. Rows are empty only when nothing concrete changes. */
export function describeChange(action: CoachAction, context: ChangeContext): ChangeSummary {
  const p = action.proposal;
  if (action.kind === "profile") {
    const rows = Object.entries(p.changes ?? {}).map(([key, value]) => ({
      label: changeLabel(key), before: context.profile ? changeValue(key, profileValue(context.profile, key)) : undefined, after: changeValue(key, value),
    }));
    return { title: "Update your training preferences", rows };
  }
  if ((action.kind === "adaptation" || action.kind === "progression") && p.workout) {
    return {
      title: action.kind === "progression" ? `Progress ${p.workout.title}` : `Adjust ${context.workout?.title ?? p.workout.title}`,
      rows: workoutRows(context.workout, p.workout),
      // Both kinds save a new workout linked to the original (see accept_action in the API).
      note: "Saved as a new copy. Your original workout stays as it is.",
    };
  }
  const after = p.program?.proposal.sessions ?? p.sessions ?? [];
  if (action.kind === "program") {
    const first = after[0]?.date;
    return { title: `New plan: ${p.program?.title ?? "Training plan"}`, rows: [{ label: "Sessions", after: `${after.length}${first ? ` · starts ${formatPlanDate(first)}` : ""}` }] };
  }
  const before = context.program?.sessions ?? [];
  const ids = new Set([...(p.session_ids ?? []), ...(p.session_id ? [p.session_id] : [])]);
  if (p.operation === "pause") {
    const paused = p.program?.schedule_state?.paused_sessions?.length ?? 0;
    return { title: "Pause your plan", rows: [{ label: "Upcoming sessions", before: "Scheduled", after: `${paused} paused, kept in order` }] };
  }
  if (p.operation === "return") {
    return { title: "Resume your plan", rows: after.filter(item => ids.has(item.id)).map(item => ({
      label: `${formatPlanDate(item.date)} · ${item.workout.title}`, before: "Paused", after: exercises(item.workout).map(e => `${e.name}: ${targets(e)}`).join("\n"),
    })) };
  }
  const title = { move: "Move a session", skip: "Skip a session", swap: "Swap two sessions", shorten: "Shorten a session",
    shift: "Shift your plan", running_stage: "Move to your next running stage", exercise_progression: "Progress an exercise in your plan" }[p.operation ?? ""] ?? "Update your plan";
  const rows = sessionRows(before, after, ids);
  const stage = p.profile?.running_baseline?.accepted_stage;
  if (stage != null) rows.unshift({ label: "Running stage", before: changeValue("stage", context.profile?.running_baseline?.accepted_stage), after: String(stage) });
  return { title, rows };
}

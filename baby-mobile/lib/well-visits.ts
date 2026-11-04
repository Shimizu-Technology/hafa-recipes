import schedule from "../content/aap_well_visits.json";
import { canPreview } from "./weekly-content";
import type { BabyRecord } from "./models";
import { midnight } from "./events";
import { dayKey } from "./tracker";

/**
 * AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW_2 Q1). AAP's visit ages, gated like the weekly batches: `approved` in the
 * file is the one switch, and a release build shows no visit or date until it's true. No screening detail is copied:
 * AAP's table is copyrighted, so this holds only the ages and a link. The two vaccine schedules are only ever linked,
 * so the app never holds a schedule of its own.
 */
export const wellVisits = schedule;
export type WellVisit = (typeof schedule.visits)[number];

export const visitsVisible = (preview = false, batch: { approved: boolean } = schedule) => batch.approved || (preview && canPreview());

/** A suggested day: the same day of the month, or the month's last day when it's shorter. */
export function visitDay(birthDate: string, visit: Pick<WellVisit, "after_birth">) {
  const [year, month, date] = birthDate.split("-").map(Number), { days = 0, months = 0 } = visit.after_birth as { days?: number; months?: number };
  if (!months) return dayKey(new Date(year, month - 1, date + days));
  const last = new Date(year, month - 1 + months + 1, 0).getDate();
  return dayKey(new Date(year, month - 1 + months, Math.min(date, last)));
}

/** Soonest first from today, and the ones already past apart, with no word about whether they happened. */
export function visitsFrom(birthDate: string, todayKey: string, visits: readonly WellVisit[] = schedule.visits) {
  const dated = visits.map((visit) => ({ visit, day: visitDay(birthDate, visit) }));
  return { upcoming: dated.filter((one) => one.day >= todayKey), past: dated.filter((one) => one.day < todayKey) };
}

/** The event a suggestion becomes: all day on that date, for this child, as an appointment she can move. */
export const visitEvent = (visit: Pick<WellVisit, "title">, childId: string, day: string, timeZone: string) =>
  ({ title: visit.title, child_id: childId, occurred_at: new Date(midnight(day, timeZone)), data: { all_day: true, timezone: timeZone, category: "appointment" as const, attendees: [] } });
/** Whether this visit is on this child's calendar already, so a second tap can't add it twice. */
export const visitOnCalendar = (rows: readonly BabyRecord[], visit: Pick<WellVisit, "title">, childId: string | null) =>
  rows.some((row) => row.kind === "event" && row.child_id === childId && row.title === visit.title);

export const shotLabel = "Shot";
/** A milestone or a shot only means something for its baby: as "general" it would drop off that baby's lists and look lost. */
export const staysWithBaby = ({ kind, data }: Pick<BabyRecord, "kind" | "data">) => kind === "milestone" || (kind === "custom" && data.label === shotLabel);
/** Shots she recorded for this child, newest first. A custom entry labelled "Shot" is all a shot is. */
export const recordedShots = (rows: readonly BabyRecord[], childId: string | null) =>
  rows.filter((row) => row.kind === "custom" && row.data.label === shotLabel && row.child_id === childId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

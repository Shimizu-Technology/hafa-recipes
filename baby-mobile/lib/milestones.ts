import cdc from "../content/cdc_milestones.json";
import type { BabyRecord } from "./models";
import { recordDay, zonedInstant } from "./tracker";

/**
 * CDC's milestones, word for word (read 2026-11-05; re-read the pages before each release, as CDC asks of anyone
 * re-posting). CDC's words may show before clinical review, with its required attribution and non-endorsement line.
 *
 * This is a keepsake list, not an assessment: nothing here counts, scores or compares a child, and nothing may. Checking
 * one off is a parent's record of a moment.
 */
export const milestones = cdc;
export type MilestoneAge = (typeof cdc.ages)[number];
export type Milestone = MilestoneAge["domains"][number]["items"][number];

/** The first list at or after this child's completed months, or the last one once they're past it. */
export function openingAge(birthDate: string | null | undefined, today: Date, ages: readonly MilestoneAge[] = cdc.ages) {
  const [year, month, date] = (birthDate ?? "").split("-").map(Number);
  if (!year || !month || !date) return ages[0];
  const months = (today.getFullYear() - year) * 12 + today.getMonth() + 1 - month - (today.getDate() < date ? 1 : 0);
  return ages.find((age) => age.months >= months) ?? ages[ages.length - 1];
}

/** A date becomes noon on the family's clock, so it stays on that day wherever the phone is. */
export const milestoneInstant = (day: string, timeZone?: string | null) => zonedInstant(day, 12, 0, timeZone);

/** Two phones can check the same one offline. Her earliest date stands, and the rest come off with it. */
export function checkedMilestones(rows: readonly BabyRecord[], childId: string | null) {
  const found = new Map<string, BabyRecord[]>();
  for (const row of rows) {
    const id = row.data.milestone_id;
    if (row.kind === "milestone" && id && row.child_id === childId) found.set(id, [...(found.get(id) ?? []), row]);
  }
  for (const list of found.values()) list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return found;
}

/** Everything checked, newest first: the keepsake list. */
export const keepsakes = (checked: ReadonlyMap<string, BabyRecord[]>) =>
  [...checked.values()].map((list) => list[0]).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

/** A date she can give: from the birth date to today. */
export function acceptableDay(day: string, birthDate: string | null | undefined, todayKey: string) {
  return day <= todayKey && (!birthDate || day >= birthDate);
}
export const dayOfRecord = (row: Pick<BabyRecord, "occurred_at">, timeZone?: string | null) => recordDay(row.occurred_at, timeZone);

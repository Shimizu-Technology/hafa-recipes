import babyMonths from "../content/baby_months_3_24.json";
import babyWeeks from "../content/baby_weeks_1_12.json";
import weeks3442 from "../content/weeks_34_42.json";
import weeks433 from "../content/weeks_4_33.json";

/** Fixed offline facts, agent-reviewed 2026-11-07 for private family use at Leon’s direction.
 * approved means this limited review, not clinician review. Cut lines are removed, including from dev previews.
 * Public/paid builds require clinician review AND WHO permission in health-release.cjs.
 */
export interface WeeklyFact { text: string; source_url: string; additional_source_urls?: string[] }
export interface WeekContent {
  week: number;
  /** "weight" reads "by weight". A stated size carries the link that stated it. */
  size_comparison: { object: string; compared_on?: string; source_url?: string };
  /** Weeks 4 to 13 have no number from a published table, and weeks 4 to 33 have no length. */
  average?: { weight: { lb: number; oz: number; display: string }; length?: { in: number; display: string }; label: string };
  facts: WeeklyFact[];
}
export interface ContentBatch {
  batch: string;
  approved: boolean;
  size_source: { used: string; urls: string[] };
  size_comparison_note: string;
  weeks: WeekContent[];
}
export const batches: readonly ContentBatch[] = [weeks3442, weeks433];

/** Only a development build can show a batch still waiting for review. `__DEV__` is false in every release build. */
export const canPreview = () => typeof __DEV__ !== "undefined" && __DEV__ === true;

/** This week's size and facts, with the batch they come from, or nothing when no approved batch covers it. */
export function weekContent(week: number, { preview = false, from = batches }: { preview?: boolean; from?: readonly ContentBatch[] } = {}) {
  for (const batch of from) {
    if (!batch.approved && !(preview && canPreview())) continue;
    const content = batch.weeks.find((one) => one.week === week);
    if (content) return { batch, content };
  }
  return null;
}

/** Whether any batch holds this week at all, approved or not, so a preview is only offered where there's something to see. */
export const weekHasDraft = (week: number) => batches.some((batch) => batch.weeks.some((one) => one.week === week));

/** What's typically happening after birth, in the same form: a batch, its one switch, and a source for every line. */
export interface AgeContent { age: number; items: WeeklyFact[] }
export interface AgeBatch { batch: string; approved: boolean; unit: string; note: WeeklyFact; periods: AgeContent[] }
export const ageBatches: readonly AgeBatch[] = [babyWeeks, babyMonths];

export type BabyAge = { unit: "week" | "month"; age: number };
/** This age's lines, with the batch they come from, or nothing when no approved batch covers it. */
export function ageContent({ unit, age }: BabyAge, { preview = false, from = ageBatches }: { preview?: boolean; from?: readonly AgeBatch[] } = {}) {
  for (const batch of from) {
    if (batch.unit !== unit || (!batch.approved && !(preview && canPreview()))) continue;
    const content = batch.periods.find((one) => one.age === age);
    if (content) return { batch, content };
  }
  return null;
}
export const ageHasDraft = ({ unit, age }: BabyAge) => ageBatches.some((batch) => batch.unit === unit && batch.periods.some((one) => one.age === age));

/** Every source link for a fact, the main one first. */
export const factSources = (fact: WeeklyFact) => [fact.source_url, ...(fact.additional_source_urls ?? [])];
/** "kidshealth.org", for a link's label. */
export const sourceName = (url: string) => url.replace(/^https?:\/\/(www\.|my\.)?/, "").split("/")[0];

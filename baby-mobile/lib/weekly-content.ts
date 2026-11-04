import weeks3442 from "../content/weeks_34_42.json";

/**
 * Weekly facts, fixed and checkable, bundled so they work with no signal. Each batch is one JSON file in `content/`.
 *
 * AWAITING CLINICIAN REVIEW. `approved` in a batch's file is the one switch: false means no fact or number from it is
 * shown. Set it to true only once a doctor has signed off that batch (MEDICAL_REVIEW sections I1 to I10, and the plan's
 * medical gate). `weekly-content.test.ts` pins the first batch to false, so turning it on takes that test too.
 *
 * No fact in the first batch depends on a baby's sex, so the child profile has no sex field. A later batch that needs
 * one adds the field then.
 */
export interface WeeklyFact { text: string; source_url: string; additional_source_urls?: string[] }
export interface WeekContent {
  week: number;
  size_comparison: { object: string };
  average: { weight: { lb: number; oz: number; display: string }; length: { in: number; display: string }; label: string };
  facts: WeeklyFact[];
}
export interface ContentBatch {
  batch: string;
  approved: boolean;
  size_source: { used: string; urls: string[] };
  size_comparison_note: string;
  weeks: WeekContent[];
}
export const batches: readonly ContentBatch[] = [weeks3442];

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

/** Every source link for a fact, the main one first. */
export const factSources = (fact: WeeklyFact) => [fact.source_url, ...(fact.additional_source_urls ?? [])];
/** "kidshealth.org", for a link's label. */
export const sourceName = (url: string) => url.replace(/^https?:\/\/(www\.|my\.)?/, "").split("/")[0];

import type { BabyRecord, Child, DeviceState, Relevance, TimingStage } from "./models";
import { glanceChild } from "./care-glance";

const day = 24 * 60 * 60_000;
/** Past 44 weeks 6 days without a birth date the due date is stale, not late pregnancy (the API's rule). */
const latestPregnancyDays = 44 * 7 + 6;

function localDay(value?: string | null) {
  const [year, month, date] = (value ?? "").split("-").map(Number);
  return year && month && date ? new Date(year, month - 1, date) : null;
}
function startOfDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Today's calendar date in the profile's time zone (as the API counts it), at local midnight. */
export function profileToday(now = new Date(), timeZone?: string | null) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now), part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
    if (part("year") && part("month") && part("day")) return new Date(part("year"), part("month") - 1, part("day"));
  } catch { /* An unknown zone falls back to the device date. */ }
  return startOfDay(now);
}

function pregnancyDays(due: Date, now: Date) {
  return 280 - Math.round((due.getTime() - startOfDay(now).getTime()) / day);
}

/** Pregnant until a birth date on or before today; past 44w6d with no birth date the parent needs to add it. */
export function todayStage(child: Pick<Child, "birth_date" | "due_date"> | null | undefined, now = new Date()) {
  if (!child) return "none" as const;
  const birth = localDay(child.birth_date), due = localDay(child.due_date);
  if (birth && birth.getTime() <= startOfDay(now).getTime()) return "baby" as const;
  if (!due) return "none" as const;
  return pregnancyDays(due, now) > latestPregnancyDays ? ("needs_birth" as const) : ("pregnancy" as const);
}

/** Completed weeks and days of 280 - (due - today), from 0 up to the API's 44 weeks 6 days. */
export function pregnancyProgress(dueDate: string, now = new Date()) {
  const due = localDay(dueDate);
  if (!due) return null;
  const left = 280 - pregnancyDays(due, now),
    days = Math.max(0, Math.min(280 - left, latestPregnancyDays));
  return { week: Math.floor(days / 7), day: days % 7, daysLeft: left };
}

/** Whose timing "now" means, like the API: the selected child, else the one ongoing pregnancy, else the one dated child. */
export function timingChild(state: Pick<DeviceState, "bootstrap" | "selectedChild">, now = new Date()) {
  const children = state.bootstrap?.children ?? [], selected = children.find((child) => child.id === state.selectedChild);
  if (selected) return selected;
  const expecting = children.filter((child) => todayStage(child, now) === "pregnancy"),
    dated = children.filter((child) => localDay(child.birth_date) || localDay(child.due_date));
  // Where the API would ask which child, keep the child Today already shows.
  return expecting.length === 1 ? expecting[0] : dated.length === 1 ? dated[0] : glanceChild(state);
}

/** "Due Dec 10 · 39 days to go". */
export function dueLine(dueDate: string, now = new Date()) {
  const due = localDay(dueDate), progress = pregnancyProgress(dueDate, now);
  if (!due || !progress) return "";
  const date = due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), left = progress.daysLeft;
  if (left === 0) return `Due today · ${date}`;
  return left > 0 ? `Due ${date} · ${left} day${left === 1 ? "" : "s"} to go`
    : `Due ${date} · ${-left} day${left === -1 ? "" : "s"} past due`;
}

/** Completed baby age in weeks, as the API counts it. */
export function babyAgeWeeks(birthDate: string, now = new Date()) {
  const birth = localDay(birthDate);
  return birth ? Math.max(0, Math.min(520, Math.floor((startOfDay(now).getTime() - birth.getTime()) / day / 7))) : 0;
}

export const weeksToMonths = (weeks: number) => Math.round((weeks * 12) / 52);
export const monthsToWeeks = (months: number) => Math.round((months * 52) / 12);

function range(min: number | null | undefined, max: number | null | undefined, unit: string, single: string) {
  const has = (value: number | null | undefined): value is number => typeof value === "number";
  if (has(min) && has(max)) return min === max ? `${single} ${min}` : `${min}–${max} ${unit}`;
  if (has(min)) return `From ${min} ${unit}`;
  if (has(max)) return `Up to ${max} ${unit}`;
  return "";
}

/** One quiet line describing only what the source (or the parent) stated. */
export function timingLabel(relevance?: Relevance | null) {
  if (!relevance) return "";
  const pregnancy = range(relevance.pregnancy_week_min, relevance.pregnancy_week_max, "weeks", "Week");
  if (pregnancy) return pregnancy;
  const months = relevance.baby_age_unit === "months",
    convert = (value?: number | null) => (typeof value === "number" && months ? weeksToMonths(value) : value),
    baby = range(convert(relevance.baby_age_min_weeks), convert(relevance.baby_age_max_weeks),
      months ? "months" : "weeks", months ? "Month" : "Week");
  if (baby) return baby;
  return relevance.stage === "pregnancy" ? "During pregnancy" : relevance.stage === "postpartum" ? "After birth"
    : relevance.stage === "baby" ? "Baby" : "";
}

export interface TimingContext {
  stage: "pregnancy" | "baby";
  value: number;
}
export function timingContext(child: Pick<Child, "birth_date" | "due_date"> | null | undefined, now = new Date()): TimingContext | null {
  const stage = todayStage(child, now);
  if (stage === "baby") return { stage, value: babyAgeWeeks(child!.birth_date!, now) };
  const progress = stage === "pregnancy" ? pregnancyProgress(child!.due_date!, now) : null;
  return progress ? { stage: "pregnancy", value: progress.week } : null;
}

function bounds(relevance: Relevance | null | undefined, stage: TimingContext["stage"]) {
  if (!relevance) return null;
  const pregnancy = stage === "pregnancy",
    low = pregnancy ? relevance.pregnancy_week_min : relevance.baby_age_min_weeks,
    high = pregnancy ? relevance.pregnancy_week_max : relevance.baby_age_max_weeks,
    stages: (TimingStage | null | undefined)[] = pregnancy ? ["pregnancy"] : ["postpartum", "baby"];
  const stated = (value: number | null | undefined): value is number => typeof value === "number";
  return stages.includes(relevance.stage) || stated(low) || stated(high)
    ? { low: stated(low) ? low : null, high: stated(high) ? high : null } : null;
}

/** The API's "now"/"upcoming" rules, used for cached tips while offline. */
export function matchesTiming(record: Pick<BabyRecord, "kind" | "data">, mode: "now" | "upcoming", context: TimingContext) {
  const range = record.kind === "source" ? bounds(record.data.relevance, context.stage) : null;
  if (!range) return false;
  return mode === "now" ? (range.low === null || range.low <= context.value) && (range.high === null || range.high >= context.value)
    : range.low !== null && range.low > context.value;
}

/** Soonest first, as the API orders "Coming up". */
export function byStart(stage: TimingContext["stage"]) {
  return (a: Pick<BabyRecord, "data">, b: Pick<BabyRecord, "data">) =>
    (bounds(a.data.relevance, stage)?.low ?? Infinity) - (bounds(b.data.relevance, stage)?.low ?? Infinity);
}

/** The parent's own category first, then an extracted topic. A pending AI suggestion isn't hers yet, so it never shows here. */
export function tipTopic(record: Pick<BabyRecord, "id" | "data">, collections: readonly Pick<BabyRecord, "kind" | "title" | "data">[]) {
  const filed = collections.find((row) => row.kind === "collection" && row.data.record_ids?.includes(record.id));
  return filed?.title || record.data.topics?.[0] || "";
}

/** The simple editor's shape: when it's useful, and an optional start/end. */
export interface TimingForm {
  stage: "pregnancy" | "baby" | "none";
  from: string;
  to: string;
  unit: "weeks" | "months";
}
export function timingForm(relevance?: Relevance | null): TimingForm {
  const months = relevance?.baby_age_unit === "months", text = (value?: number | null) => typeof value === "number" ? String(value) : "";
  if (relevance && (relevance.stage === "pregnancy" || typeof relevance.pregnancy_week_min === "number" || typeof relevance.pregnancy_week_max === "number"))
    return { stage: "pregnancy", from: text(relevance.pregnancy_week_min), to: text(relevance.pregnancy_week_max), unit: "weeks" };
  if (relevance && (relevance.stage || typeof relevance.baby_age_min_weeks === "number" || typeof relevance.baby_age_max_weeks === "number")) {
    const convert = (value?: number | null) => text(typeof value === "number" && months ? weeksToMonths(value) : value);
    return { stage: "baby", from: convert(relevance.baby_age_min_weeks), to: convert(relevance.baby_age_max_weeks), unit: months ? "months" : "weeks" };
  }
  return { stage: "none", from: "", to: "", unit: "months" };
}

/** Validate the editor and build the API value. `null` clears timing; an unchanged form keeps the source's quote. */
export function relevanceFromForm(form: TimingForm, prior?: Relevance | null): { relevance: Relevance | null } | { error: string } {
  if (form.stage === "none") return { relevance: null };
  const limit = form.stage === "pregnancy" ? 45 : form.unit === "months" ? 120 : 520,
    noun = form.stage === "pregnancy" ? "week" : form.unit === "months" ? "month" : "week";
  const read = (value: string) => {
    const text = value.trim();
    if (!text) return null;
    return /^\d{1,3}$/.test(text) && Number(text) <= limit ? Number(text) : NaN;
  };
  const from = read(form.from), to = read(form.to);
  if (Number.isNaN(from) || Number.isNaN(to)) return { error: `Enter a ${noun} from 0 to ${limit}.` };
  if (from !== null && to !== null && from > to) return { error: "The start needs to come before the end." };
  const weeks = (value: number | null) => value === null ? null : form.unit === "months" ? monthsToWeeks(value) : value;
  const value: Relevance = form.stage === "pregnancy"
    ? { stage: "pregnancy", pregnancy_week_min: from, pregnancy_week_max: to, baby_age_min_weeks: null, baby_age_max_weeks: null, baby_age_unit: null }
    : { stage: prior?.stage === "postpartum" ? "postpartum" : "baby", pregnancy_week_min: null, pregnancy_week_max: null,
      baby_age_min_weeks: weeks(from), baby_age_max_weeks: weeks(to), baby_age_unit: form.unit };
  const stated = (key: keyof Relevance, from?: Relevance | null) =>
    key === "baby_age_unit" && value.stage !== "pregnancy" ? from?.[key] ?? "weeks" : from?.[key] ?? null;
  const same = prior && (Object.keys(value) as (keyof Relevance)[]).every((key) => stated(key, prior) === stated(key, value));
  return { relevance: { ...value, quote: same ? prior.quote ?? null : null } };
}

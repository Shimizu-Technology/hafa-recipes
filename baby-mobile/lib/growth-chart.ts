import who from "../content/who_growth.json";
import notes from "../content/growth_notes.json";
import { weightText } from "./care-format";
import type { BabyRecord, ChildDetails } from "./models";
import { keyDate, recordDay } from "./tracker";

/**
 * WHO Child Growth Standards under 2 years, as CDC advises, from CDC's own files, bundled so they work with no signal
 * (`scripts/build-who-growth.mjs` builds the JSON, and sources are in SOURCES.md). Nothing here reads a measurement: a
 * percentile is the file's arithmetic, and what it means is for CDC's words and the baby's doctor.
 *
 * `growth_notes.json` holds what's ours. AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW_3): `approved` is the one switch, and
 * `growth-chart.test.ts` pins it false, so turning it on takes that test too.
 */
export const whoGrowth = who as unknown as { source: { name: string; url: string; files: string; retrieved: string; sha256: Record<string, string> }; units: Record<Measure, string>; columns: string[]; charts: Record<ChartSex, Record<Measure, number[][]>> };
export const growthNotes = notes;
export const visibleGrowthNotes = (batch: { approved: boolean; notes: string[] } = notes) => (batch.approved ? batch.notes : []);

export type ChartSex = "boys" | "girls";
export type Measure = "weight" | "length" | "head";
export type ChartUnit = "kg" | "lb" | "cm" | "in";
export const measureWords: Record<Measure, string> = { weight: "Weight", length: "Length", head: "Head" };
/** The columns of CDC's files, in order. The outer two are labelled 2nd and 98th, and sit at exactly two standard deviations. */
export const percentileLines = [2, 5, 10, 25, 50, 75, 90, 95, 98] as const;
const lbInKg = 0.45359237, cmInInch = 2.54, daysInMonth = 30.4375;
export const lastMonth = 24;

const toMetric = (value: number, unit: ChartUnit) => (unit === "lb" ? value * lbInKg : unit === "in" ? value * cmInInch : value);
const fromMetric = (value: number, unit: ChartUnit) => (unit === "lb" ? value / lbInKg : unit === "in" ? value / cmInInch : value);

export const ageMonths = (birthDate: string, day: string) => Math.round((keyDate(day).getTime() - keyDate(birthDate).getTime()) / 86_400_000) / daysInMonth;

/** L, M and S at this age, read straight between the two months around it. Nothing outside 0 to 24 months. */
export function lmsAt(sex: ChartSex, measure: Measure, months: number) {
  if (!(months >= 0 && months <= lastMonth)) return null;
  const rows = whoGrowth.charts[sex][measure], below = rows[Math.floor(months)], above = rows[Math.ceil(months)], part = months - below[0],
    between = (column: number) => (part ? below[column] + part * (above[column] - below[column]) : below[column]);
  return { L: between(1), M: between(2), S: between(3) };
}

/** CDC's formula for an exact z-score from L, M and S. */
export function zScore(value: number, { L, M, S }: { L: number; M: number; S: number }) {
  return L === 0 ? Math.log(value / M) / S : ((value / M) ** L - 1) / (L * S);
}

/** The share of a standard normal curve below z, to better than a hundredth of a percentile (Numerical Recipes' erfcc). */
export function normalCdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.5 * x),
    tail = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? 1 - tail / 2 : tail / 2;
}

export function percentile(sex: ChartSex, measure: Measure, months: number, metric: number) {
  const lms = lmsAt(sex, measure, months);
  return lms && metric > 0 ? normalCdf(zScore(metric, lms)) * 100 : null;
}

const ordinal = (value: number) => {
  const tens = value % 100, ones = value % 10;
  return `${value}${tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
};
const lowLine = normalCdf(-2) * 100, highLine = normalCdf(2) * 100;
/** Past the outermost lines CDC draws there's no meaningful number to give, so it says where it is against them. */
export function percentileWords(value: number) {
  if (value < lowLine) return "Below the 2nd percentile line";
  if (value > highLine) return "Above the 98th percentile line";
  return `${ordinal(Math.round(value))} percentile`;
}

/** One of CDC's lines across the chart, in the unit being shown. */
export function curve(sex: ChartSex, measure: Measure, line: (typeof percentileLines)[number], unit: ChartUnit) {
  const column = 4 + percentileLines.indexOf(line);
  return whoGrowth.charts[sex][measure].map((row) => ({ months: row[0], value: fromMetric(row[column], unit) }));
}

/** Where a measurement sits on a chart reading in this unit, whatever unit it was saved in. */
export const plottedIn = (point: Pick<GrowthPoint, "metric">, unit: ChartUnit) => fromMetric(point.metric, unit);

export interface GrowthPoint { /** Null for the measurement at birth, which comes from her setup answers rather than an entry. */ record: BabyRecord | null; atBirth?: boolean; day: string; months: number; metric: number; shown: number; unit: ChartUnit; text: string; onChart: boolean; percentile: number | null }

// The units the API allows. A record with anything else is left off rather than read as metric.
const unitsFor: Record<Measure, readonly ChartUnit[]> = { weight: ["kg", "lb"], length: ["cm", "in"], head: ["cm", "in"] };

type AtBirth = Pick<ChildDetails, "weight_at_birth_g" | "length_at_birth_cm">;
/** What setup says for one measure, in CDC's units. Head isn't asked. */
const birthMetric = (details: AtBirth | null | undefined, measure: Measure) =>
  (measure === "weight" ? (details?.weight_at_birth_g ? details.weight_at_birth_g / 1000 : null) : measure === "length" ? details?.length_at_birth_cm ?? null : null);
/** Grams and centimetres typed once, in the words a logged measurement of that unit would use. */
function birthText(metric: number, measure: Measure, unit: ChartUnit) {
  if (measure !== "weight") return `${Math.round(fromMetric(metric, unit) * 10) / 10} ${unit}`;
  return weightText(unit === "lb" ? fromMetric(metric, unit) : Math.round(metric * 100 + 1e-6) / 100, unit);
}
/** A logged measure on the birth day is the same moment, so the page and the chart have it once. */
const birthDay = (child: { birth_date?: string | null }, day: string) => child.birth_date === day;
/** The words for what setup says at birth, less what's logged on the birth day. Pounds and inches unless she logs in another. */
export function birthWords(child: { birth_date?: string | null; details?: AtBirth | null }, logs: readonly BabyRecord[], timeZone?: string | null) {
  const newest = (key: "weight_unit" | "length_unit") => logs.map((row) => (row.data as Record<string, unknown>)[key]).find(Boolean) as ChartUnit | undefined;
  return (["weight", "length"] as const).flatMap((measure) => {
    const metric = birthMetric(child.details, measure),
      logged = logs.some((row) => row.kind === "growth" && typeof (row.data as Record<string, unknown>)[measure] === "number" && birthDay(child, recordDay(row.occurred_at, timeZone)));
    return metric && child.birth_date && !logged ? [birthText(metric, measure, newest(`${measure}_unit`) ?? (measure === "weight" ? "lb" : "in"))] : [];
  });
}

/** This baby's measurements of one kind, oldest first. The value stays in the unit she entered, and is compared in CDC's. */
export function measuredOn(rows: readonly BabyRecord[], child: { id: string; birth_date?: string | null; details?: AtBirth | null }, sex: ChartSex | null, measure: Measure, timeZone?: string | null, today?: string) {
  const points: GrowthPoint[] = [];
  for (const record of rows) {
    const data = record.data as Record<string, unknown>, value = data[measure], unit = data[`${measure}_unit`] as ChartUnit | undefined;
    if (record.kind !== "growth" || record.child_id !== child.id || typeof value !== "number" || !(value > 0) || !Number.isFinite(value) || !unit || !unitsFor[measure].includes(unit) || !child.birth_date) continue;
    const day = recordDay(record.occurred_at, timeZone), months = ageMonths(child.birth_date, day), metric = toMetric(value, unit), onChart = (!today || day <= today) && months >= 0 && months <= lastMonth;
    points.push({ record, day, months, metric, shown: value, unit, onChart, text: measure === "weight" ? weightText(value, unit) : `${value} ${unit}`,
      percentile: sex && onChart ? percentile(sex, measure, months, metric) : null });
  }
  points.sort((a, b) => a.months - b.months || a.record!.occurred_at.localeCompare(b.record!.occurred_at));
  const metric = birthMetric(child.details, measure);
  if (metric && child.birth_date && !points.some((point) => point.day === child.birth_date)) {
    const unit = points[points.length - 1]?.unit ?? (measure === "weight" ? "lb" : "in");
    points.unshift({ record: null, atBirth: true, day: child.birth_date, months: 0, metric, shown: fromMetric(metric, unit), unit, onChart: true,
      text: birthText(metric, measure, unit), percentile: sex ? percentile(sex, measure, 0, metric) : null });
  }
  return points;
}

/**
 * Which of CDC's two sets of charts the baby's profile points to. Nothing is assumed: "Not sure yet", or no answer, is
 * null, and the screen asks.
 */
export function chartFromChild(child: { details?: { sex?: string | null } | null }): ChartSex | null {
  const sex = child.details?.sex?.trim().toLowerCase();
  return sex === "girl" || sex === "female" ? "girls" : sex === "boy" || sex === "male" ? "boys" : null;
}
/** The chart reads in the unit of her latest measurement, and pounds and inches until there is one. */
export const chartUnit = (points: readonly GrowthPoint[], measure: Measure): ChartUnit => points[points.length - 1]?.unit ?? (measure === "weight" ? "lb" : "in");

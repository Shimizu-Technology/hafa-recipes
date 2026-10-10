import type { TrainingProfile } from "./models";
export type MeasurementKind = "weight" | "height";
export type MeasurementUnit = "kg" | "lb" | "cm" | "in";
export interface Measurement {
  id: string;
  generation: number;
  revision: number;
  kind: MeasurementKind;
  value: number | null;
  unit: MeasurementUnit | null;
  canonical_value: number | null;
  canonical_unit: "kg" | "cm" | null;
  recorded_at: string | null;
  source: "user";
  is_current: boolean;
  status: "active" | "removed";
  created_at: string;
  updated_at: string;
}
export interface MeasurementPage {
  items: Measurement[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
export interface MeasurementWrite {
  request_id: string;
  kind?: MeasurementKind;
  expected_revision?: number;
  value: number;
  unit: MeasurementUnit;
  recorded_at: string;
  source: "user";
  update_current: boolean;
}
export interface MeasurementResult {
  measurement: Measurement;
  profile_revision: number;
  current_applied: boolean;
  profile: TrainingProfile | null;
  context_reset: boolean;
}
export function measurementErrors(
  kind: MeasurementKind,
  value: string,
  unit: MeasurementUnit,
  recorded_at: string | null
) {
  const number = Number(value);
  const canonical = unit === "lb" ? number * 0.45359237 : unit === "in" ? number * 2.54 : number;
  const errors: string[] = [];
  if (!value.trim() || !Number.isFinite(canonical) || canonical <= 0 || canonical > (kind === "weight" ? 500 : 300))
    errors.push(
      `Enter a ${kind === "weight" ? "weight greater than zero and no more than 500 kg" : "height greater than zero and no more than 300 cm"}, in your selected unit.`
    );
  if (kind === "weight" ? !["kg", "lb"].includes(unit) : !["cm", "in"].includes(unit))
    errors.push("Choose a unit for this measurement.");
  if (!recorded_at || !parseRecordedTime(recorded_at) || Date.parse(recorded_at) > Date.now() + 60000)
    errors.push("Choose the date and time when you took this measurement, up to now.");
  return errors;
}
export function measurementDisplay(record: Measurement) {
  return record.value == null || !record.unit ? "Removed measurement" : `${record.value} ${record.unit}`;
}
export function parseRecordedTime(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]),
    hour = Number(match[4]),
    minute = Number(match[5]),
    second = Number(match[6] ?? 0);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (
    !match[7] &&
    (date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute)
  )
    return null;
  return date.toISOString();
}
export function profileMeasurementErrors(profile: TrainingProfile, baseline?: TrainingProfile | null) {
  const errors: string[] = [];
  for (const [kind, key, dateKey] of [
    ["weight", "weight_kg", "weight_recorded_at"],
    ["height", "height_cm", "height_recorded_at"],
  ] as const) {
    const value = profile[key];
    if (value == null || !Number.isFinite(value) || value === baseline?.[key]) continue;
    const date = profile[dateKey];
    if (!date || !parseRecordedTime(date) || Date.parse(date) > Date.now() + 60000)
      errors.push(`Choose when you measured the changed ${kind}.`);
  }
  return errors;
}

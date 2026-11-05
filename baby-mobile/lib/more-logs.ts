import type { BabyRecord, Kind, RecordData } from "./models";
import { kindName } from "./models";
import { methodWords } from "./care-format";
import { newestFirst } from "./feed-reducer";
import { trackerById, trackerFor, trackers } from "./trackers";

export { moreKinds } from "./trackers";
export const noteLabel = trackerById("note")!.dataLabel!;
export const feelingWords = ["Great", "Good", "Okay", "Tired", "Rough"] as const;

export interface LogForm {
  side: "left" | "right" | "both"; amount: string; amountUnit: "oz" | "ml"; minutes: string;
  name: string; dose: string;
  value: string; unit: "f" | "c"; method: keyof typeof methodWords | "";
  weightUnit: "lb" | "kg"; lb: string; oz: string; kg: string; length: string; lengthUnit: "in" | "cm"; head: string; headUnit: "in" | "cm";
  label: string;
  myWeight: string; myWeightUnit: "lb" | "kg";
  top: string; bottom: string;
  /** A saved weight and how it reads, so editing something else can't round it. */
  savedWeight?: { value: number; lb: string; oz: string };
}
const blank: LogForm = { side: "both", amount: "", amountUnit: "oz", minutes: "", name: "", dose: "", value: "", unit: "f", method: "",
  weightUnit: "lb", lb: "", oz: "", kg: "", length: "", lengthUnit: "in", head: "", headUnit: "in", label: "", myWeight: "", myWeightUnit: "lb", top: "", bottom: "" };

const newestOf = (rows: readonly BabyRecord[], id: string, childId: string | null) => rows.filter((row) => trackerFor(row)?.id === id && row.child_id === childId).sort(newestFirst);
/** A time ahead of the clock can't be the last time anything happened. */
const happened = (rows: BabyRecord[], now: Date) => rows.filter((row) => new Date(row.occurred_at).getTime() <= now.getTime());
export const lastLog = (rows: readonly BabyRecord[], id: string, childId: string | null) => newestOf(rows, id, childId)[0] as BabyRecord | undefined;

/** Blank, in the units she last used. Ounces, pounds and inches until she uses something else. */
export function startForm(id: string, rows: readonly BabyRecord[], childId: string | null): LogForm {
  const data = (lastLog(rows, id, childId)?.data ?? {}) as Record<string, unknown>,
    // Each from the newest entry that has it, so a head-only entry doesn't reset the others.
    lastUnit = (field: string) => newestOf(rows, id, childId).map((row) => (row.data as Record<string, unknown>)[field]).find(Boolean);
  return { ...blank,
    ...(id === "temperature" && data.unit === "c" ? { unit: "c" as const } : {}),
    ...(id === "my_weight" && data.unit === "kg" ? { myWeightUnit: "kg" as const } : {}),
    ...(id === "growth" ? { weightUnit: lastUnit("weight_unit") === "kg" ? "kg" as const : "lb" as const, lengthUnit: lastUnit("length_unit") === "cm" ? "cm" as const : "in" as const, headUnit: lastUnit("head_unit") === "cm" ? "cm" as const : "in" as const } : {}),
  };
}

const text = (value: unknown) => (typeof value === "number" ? String(value) : "");
/** What a saved entry holds, for its editor. */
export function formFrom(id: string, data: RecordData, title = ""): LogForm {
  const d = data as Record<string, any>;
  if (id === "pumping") return { ...blank, side: d.side ?? "both", amount: text(d.amount), amountUnit: d.unit === "ml" ? "ml" : "oz", minutes: text(d.duration_minutes) };
  if (id === "medicine") return { ...blank, name: d.name ?? "", dose: d.dose ?? "" };
  if (id === "temperature") return { ...blank, value: text(d.value), unit: d.unit === "c" ? "c" : "f", method: d.method ?? "" };
  if (id === "custom") return { ...blank, label: d.label ?? "" };
  if (id === "feeling" || id === "vitamins") return { ...blank, name: title };
  if (id === "my_weight") return { ...blank, myWeight: text(d.value), myWeightUnit: d.unit === "kg" ? "kg" : "lb" };
  if (id === "blood_pressure") { const [top = "", bottom = ""] = title.split("/"); return { ...blank, top, bottom }; }
  const ounces = typeof d.weight === "number" && d.weight_unit === "lb" ? Math.round(d.weight * 160) / 10 : null, pounds = ounces === null ? null : Math.floor(ounces / 16);
  const lb = pounds === null ? "" : String(pounds), oz = pounds === null ? "" : String(Math.round((ounces! - pounds * 16) * 10) / 10);
  return { ...blank, weightUnit: d.weight_unit === "kg" ? "kg" : "lb", kg: d.weight_unit === "kg" ? text(d.weight) : "", lb, oz,
    ...(pounds === null ? {} : { savedWeight: { value: d.weight, lb, oz } }),
    length: text(d.length), lengthUnit: d.length_unit === "cm" ? "cm" : "in", head: text(d.head), headUnit: d.head_unit === "cm" ? "cm" : "in" };
}

/** "37,5" reads as 37.5, as a phone in another language types it. Empty or not a number is NaN, as is "1,000", which could be either. */
const decimal = (value: string) => { const typed = value.trim(); return typed && !/,\d{3}$/.test(typed) ? Number(typed.replace(",", ".")) : Number.NaN; };
const kgInLb = 0.45359237;

/** Changing between lb and kg carries the weight over, so nothing typed is lost to the field that's gone. */
export function changeWeightUnit(form: LogForm, weightUnit: LogForm["weightUnit"]): LogForm {
  if (form.weightUnit === weightUnit) return form;
  if (weightUnit === "kg") {
    const pounds = (form.lb.trim() ? decimal(form.lb) : 0) + (form.oz.trim() ? decimal(form.oz) : 0) / 16;
    return { ...form, weightUnit, kg: pounds > 0 ? String(Math.round(pounds * kgInLb * 100) / 100) : "", lb: "", oz: "" };
  }
  const kilos = form.kg.trim() ? decimal(form.kg) : 0;
  if (!(kilos > 0)) return { ...form, weightUnit, kg: "" };
  const ounces = Math.round(kilos / kgInLb * 160) / 10, pounds = Math.floor(ounces / 16);
  return { ...form, weightUnit, lb: String(pounds), oz: String(Math.round((ounces - pounds * 16) * 10) / 10), kg: "" };
}

const plainLabel = (label: string) => label.trim().toLowerCase().replace(/’/g, "'");
/** Labels that mean a tracker of their own. Saved as a custom log, one would turn into that tracker on the next read. */
const reservedLabels = new Set(trackers.flatMap((tracker) => (tracker.id === "custom" ? [] : [tracker.dataLabel, tracker.label])).filter((label): label is string => !!label).map(plainLabel));
const measured = (value: string, top: number) => {
  const number = decimal(value);
  if (!Number.isFinite(number) || number <= 0 || number > top) throw Error("Check that number.");
  return number;
};
/** The readings a thermometer can give on each scale, so a typo or the wrong scale is caught here and not by the API. It says nothing about the reading. */
const thermometer = { f: [68, 122], c: [20, 50] } as const;

/** The saved shape of each tracker, as the API validates it, or an error she can act on. `base` keeps what the form doesn't show. */
export function dataFrom(id: string, form: LogForm, base: Record<string, unknown> = {}): RecordData {
  const made: Record<string, unknown> = {}, dataLabel = trackerById(id)?.dataLabel;
  if (id === "pumping") {
    made.side = form.side;
    if (form.amount.trim()) { made.amount = measured(form.amount, 10000); made.unit = form.amountUnit; }
    if (form.minutes.trim()) made.duration_minutes = measured(form.minutes, 1440);
    return { ...withoutKeys(base, ["amount", "unit", "duration_minutes"]), ...made } as RecordData;
  }
  if (id === "medicine") {
    const name = form.name.trim(), dose = form.dose.trim();
    if (!name) throw Error("Add the medicine’s name.");
    return { name, ...(dose ? { dose } : {}) } as unknown as RecordData;
  }
  if (id === "temperature") {
    if (!form.value.trim()) throw Error("Enter the temperature.");
    const value = decimal(form.value), [low, high] = thermometer[form.unit];
    if (!Number.isFinite(value) || value < low || value > high) throw Error("Check the number and whether it’s °F or °C.");
    return { value, unit: form.unit, ...(form.method ? { method: form.method } : {}) } as unknown as RecordData;
  }
  if (id === "custom") {
    const label = form.label.trim();
    if (!label) throw Error("Say what it is.");
    if (reservedLabels.has(plainLabel(label))) throw Error(`“${label}” has its own place. Try another name.`);
    return { ...base, label } as RecordData;
  }
  if (id === "feeling") {
    if (!form.name.trim()) throw Error("Say how you’re feeling.");
    return { label: dataLabel };
  }
  if (id === "vitamins") {
    if (!form.name.trim()) throw Error("Say what you took.");
    return { label: dataLabel };
  }
  if (id === "my_weight") {
    if (!form.myWeight.trim()) throw Error("Enter your weight.");
    return { label: dataLabel, value: measured(form.myWeight, 1000), unit: form.myWeightUnit } as unknown as RecordData;
  }
  if (id === "blood_pressure") {
    if (!form.top.trim() || !form.bottom.trim()) throw Error("Enter both numbers.");
    measured(form.top, 999); measured(form.bottom, 999);
    return { label: dataLabel };
  }
  if (form.weightUnit === "kg" ? form.kg.trim() : form.lb.trim() || form.oz.trim()) {
    if (form.weightUnit === "kg") made.weight = measured(form.kg, 500);
    else {
      const ounces = form.oz.trim() ? decimal(form.oz) : 0, pounds = form.lb.trim() ? decimal(form.lb) : 0;
      if (!(ounces >= 0 && ounces < 16)) throw Error("Keep the ounces under 16.");
      const saved = form.savedWeight;
      made.weight = saved && saved.lb === form.lb && saved.oz === form.oz ? saved.value : Math.round(measured(String(pounds + ounces / 16), 500) * 10000) / 10000;
    }
    made.weight_unit = form.weightUnit;
  }
  if (form.length.trim()) { made.length = measured(form.length, 300); made.length_unit = form.lengthUnit; }
  if (form.head.trim()) { made.head = measured(form.head, 100); made.head_unit = form.headUnit; }
  if (!Object.keys(made).length) throw Error("Enter a measurement.");
  return made as RecordData;
}
const withoutKeys = (data: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));

/** The entry's title. For a `custom` log that's what she said, as a shot's title is its name, since the API keeps no other field for it. */
export function logTitle(id: string, form: LogForm) {
  if (id === "medicine" || id === "feeling" || id === "vitamins") return form.name.trim();
  if (id === "custom") return form.label.trim();
  if (id === "blood_pressure") return `${form.top.trim()}/${form.bottom.trim()}`;
  const tracker = trackerById(id);
  return tracker?.dataLabel ?? kindName[tracker?.kind ?? "custom"];
}

/**
 * A medicine to log again in one tap, once each however often she gave it or however the dose was typed, with its newest
 * time. No timing or dosing advice comes with it.
 */
export function recentMedicines(rows: readonly BabyRecord[], childId: string | null, count = 3, now = new Date()) {
  const seen = new Set<string>(), found: { name: string; dose: string; at: string }[] = [];
  for (const row of happened(newestOf(rows, "medicine", childId), now)) {
    const { name, dose } = row.data as unknown as { name?: string; dose?: string }, key = name?.trim().toLowerCase();
    if (name && key && !seen.has(key)) { seen.add(key); found.push({ name, dose: dose ?? "", at: row.occurred_at }); }
  }
  return found.slice(0, count);
}
/** The last time this medicine was logged, for a name she's typing that may not be one of those offered. */
export const lastDose = (rows: readonly BabyRecord[], childId: string | null, name: string, now = new Date()) =>
  name.trim() ? recentMedicines(rows, childId, Infinity, now).find((one) => one.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
export function recentVitamins(rows: readonly BabyRecord[], childId: string | null, count = 3, now = new Date()) {
  const seen = new Set<string>(), found: { name: string; at: string }[] = [];
  for (const row of happened(newestOf(rows, "vitamins", childId), now)) {
    if (!seen.has(row.title.toLowerCase())) { seen.add(row.title.toLowerCase()); found.push({ name: row.title, at: row.occurred_at }); }
  }
  return found.slice(0, count);
}
/** Labels she has made up herself. A shot, a note and the trackers with their own label are never offered as one. */
export function recentCustomLabels(rows: readonly BabyRecord[], childId: string | null, count = 4) {
  const labels = newestOf(rows, "custom", childId).map((row) => row.data.label).filter((label): label is string => !!label && !trackers.some((tracker) => tracker.dataLabel === label));
  return [...new Set(labels)].slice(0, count);
}

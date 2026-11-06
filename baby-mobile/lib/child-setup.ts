import { ApiError } from "./api";
import { friendlyDate } from "./care-format";
import { newestFirst } from "./feed-reducer";
import { messageFor, type BabyRecord, type Child, type ChildDetails, type ChildDraft, type ChildEdits, type ChildField, type ChildForm, type DeviceState } from "./models";
import { contactFrom, contactProblem } from "./contacts";
import { dayKey } from "./tracker";
import { pregnancyProgress } from "./timing";

export type { ChildEdits, ChildField, ChildForm };
export type SetupStage = NonNullable<ChildForm["stage"]>;
export type MeasureUnit = ChildForm["unit"];

const gramsPerOunce = 28.349523125, cmPerInch = 2.54;
/** The API's 44 weeks 6 days, past which a due date is stale rather than late pregnancy. */
const latestDays = 44 * 7 + 6;
const measure = { minGrams: 100, maxGrams: 10000, minCm: 15, maxCm: 80 };

/** A blank is null. What isn't a plain non-negative number is NaN, a comma counting as the decimal point. */
function amount(text: string) {
  const value = text.trim().replace(",", ".");
  if (!value) return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : NaN;
}
const plain = (value: number) => String(Math.round(value * 1000) / 1000);

export function weightFields(grams: number | null | undefined, unit: MeasureUnit) {
  if (grams == null) return { lb: "", oz: "", kg: "" };
  if (unit === "metric") return { lb: "", oz: "", kg: plain(grams / 1000) };
  // Round the whole count first, so 15.96 oz carries to the next pound rather than showing 16.
  const ounces = Math.round((grams / gramsPerOunce) * 10) / 10, pounds = Math.floor(ounces / 16);
  return { lb: String(pounds), oz: plain(ounces - pounds * 16), kg: "" };
}
export function lengthField(cm: number | null | undefined, unit: MeasureUnit) {
  if (cm == null) return "";
  return unit === "metric" ? plain(cm) : plain(Math.round((cm / cmPerInch) * 10) / 10);
}
function typedGrams(form: Pick<ChildForm, "unit" | "lb" | "oz" | "kg">) {
  if (form.unit === "metric") {
    const kg = amount(form.kg);
    return kg === null ? null : Math.round(kg * 1000);
  }
  const lb = amount(form.lb), oz = amount(form.oz);
  if (lb === null && oz === null) return null;
  if ((oz ?? 0) >= 16) return NaN;
  return Math.round(((lb ?? 0) * 16 + (oz ?? 0)) * gramsPerOunce);
}
function typedCm(form: Pick<ChildForm, "unit" | "length">) {
  const value = amount(form.length);
  if (value === null) return null;
  return Math.round((form.unit === "metric" ? value : value * cmPerInch) * 10) / 10;
}

/** The exact value if there is one, otherwise whatever's typed. */
const gramsOf = (form: ChildForm) => form.grams ?? typedGrams(form);
const cmOf = (form: ChildForm) => form.cm ?? typedCm(form);

function progressFields(due: string, today: Date) {
  const progress = due ? pregnancyProgress(due, today) : null;
  // Only a count that could be real: further off or further past than that, the date stands on its own.
  if (!progress || progress.daysLeft > 280 || 280 - progress.daysLeft > latestDays) return { weeks: "", days: "" };
  return { weeks: String(progress.week), days: String(progress.day) };
}
function stageOf(child: Child | undefined, today: Date): SetupStage | null {
  if (child?.birth_date && child.birth_date <= dayKey(today)) return "here";
  return child?.due_date || child?.birth_date ? "expecting" : null;
}

/** What Today asked for, otherwise what the profile's dates say. */
export function formFor(child: Child | undefined, requested: SetupStage | null, today: Date, unit: MeasureUnit): ChildForm {
  const details = child?.details ?? {}, stage = requested ?? stageOf(child, today),
    form: ChildForm = {
      stage: null, name: child?.name ?? "", birth: child?.birth_date ?? "", due: child?.due_date ?? "",
      ...progressFields(child?.due_date ?? "", today),
      sex: details.sex ?? "", unit,
      grams: details.weight_at_birth_g ?? null, ...weightFields(details.weight_at_birth_g, unit),
      cm: details.length_at_birth_cm ?? null, length: lengthField(details.length_at_birth_cm, unit),
      weeksAtBirth: details.weeks_at_birth == null ? "" : String(details.weeks_at_birth), feeding: details.feeding ?? "",
      doctorName: details.doctor?.name ?? "", doctorPhone: details.doctor?.phone ?? "",
    };
  return stage ? chooseStage(form, stage, today) : form;
}
/**
 * Baby's here starts on today's date, the same as the one tap on Today, and she can change or clear it.
 * Not when the due date is long past: that's someone adding a birth from a while ago, and she picks it.
 */
export function chooseStage(form: ChildForm, stage: SetupStage, today: Date): ChildForm {
  const progress = form.due ? pregnancyProgress(form.due, today) : null, stale = !!progress && 280 - progress.daysLeft > latestDays;
  return { ...form, stage, birth: stage === "here" && !form.birth && !stale ? dayKey(today) : form.birth };
}
export function chooseDue(form: ChildForm, due: string, today: Date): ChildForm {
  return { ...form, due, ...progressFields(due, today) };
}
function progressDays(form: Pick<ChildForm, "weeks" | "days">) {
  const weeks = amount(form.weeks), days = amount(form.days);
  // A lone 0 in days is what showing a date back left there, not something she typed.
  if (weeks === null && !days && !Number.isNaN(days)) return null;
  const total = (weeks ?? 0) * 7 + (days ?? 0);
  return Number.isInteger(weeks ?? 0) && Number.isInteger(days ?? 0) && (days ?? 0) <= 6 && total <= latestDays ? total : NaN;
}
export const progressProblem = (form: Pick<ChildForm, "weeks" | "days">) => Number.isNaN(progressDays(form))
  ? "Enter weeks from 0 to 44 and days from 0 to 6, or pick the due date instead." : "";
/** The API counts 280 days back from the due date, so she gets the date that gives back what she typed. */
export function typeProgress(form: ChildForm, change: Partial<Pick<ChildForm, "weeks" | "days">>, today: Date): ChildForm {
  const next = { ...form, ...change }, total = progressDays(next);
  if (total === null || Number.isNaN(total)) return { ...next, due: "" };
  return { ...next, due: dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 280 - total)) };
}
export function dueSaid(due: string) {
  const [year, month, day] = due.split("-").map(Number);
  return `Due ${new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`;
}
/** Only after `measureProblem` says it can be converted: text that isn't a number has nothing to convert to. */
export function changeUnit(form: ChildForm, unit: MeasureUnit): ChildForm {
  if (unit === form.unit) return form;
  const grams = gramsOf(form), cm = cmOf(form);
  return { ...form, unit, grams, cm, ...weightFields(grams, unit), length: lengthField(cm, unit) };
}
/** Follows the bottle: ounces until she uses something else. */
export function startingUnit(rows: BabyRecord[]): MeasureUnit {
  const last = rows.filter((row) => row.kind === "feeding" && row.data.method === "bottle" && row.data.unit).sort(newestFirst)[0];
  return last?.data.unit === "ml" ? "metric" : "imperial";
}

const fieldKeys: Record<ChildField, readonly (keyof ChildForm)[]> = {
  stage: ["stage"], name: ["name"], birth: ["birth"], due: ["due", "weeks", "days"], sex: ["sex"],
  weight: ["grams", "lb", "oz", "kg"], length: ["cm", "length"], weeksAtBirth: ["weeksAtBirth"], feeding: ["feeding"],
  doctorName: ["doctorName"], doctorPhone: ["doctorPhone"],
};
export const noEdits = (form: ChildForm, touched: ChildField[] = []): ChildEdits => ({ form, touched, attempted: false, since: [] });
/** Called by each field's own change handler. It's the only way a field becomes hers. */
export function touch(edits: ChildEdits, field: ChildField, change: (form: ChildForm) => ChildForm): ChildEdits {
  const add = (list: ChildField[]) => (list.includes(field) ? list : [...list, field]);
  return { form: change(edits.form), touched: add(edits.touched), attempted: edits.attempted, since: edits.attempted ? add(edits.since) : edits.since };
}
/** The latest profile, with what she touched on top. Nothing else is kept, so an untouched field can't show anything older. */
export function shownForm(child: Child | undefined, edits: ChildEdits, today: Date): ChildForm {
  const form = formFor(child, null, today, edits.form.unit);
  for (const field of edits.touched) for (const key of fieldKeys[field]) Object.assign(form, { [key]: edits.form[key] });
  return form.stage === "here" && !edits.touched.includes("birth") ? chooseStage(form, "here", today) : form;
}

/** A measure she touched that can't be saved. One she didn't isn't hers to fix just for opening the screen. */
export function measureProblem(form: ChildForm, touched: readonly ChildField[]) {
  const grams = gramsOf(form), cm = cmOf(form);
  if (touched.includes("weight") && grams !== null && !(grams >= measure.minGrams && grams <= measure.maxGrams))
    return form.unit === "metric" ? "Check the birth weight. Use 0.1 to 10 kg." : "Check the birth weight. Use up to 22 lb, with ounces under 16.";
  if (touched.includes("length") && cm !== null && !(cm >= measure.minCm && cm <= measure.maxCm))
    return form.unit === "metric" ? "Check the birth length. Use 15 to 80 cm." : "Check the birth length. Use 6 to 31 in.";
  return "";
}
/** Birth-only answers wait while she's expecting. `tracking` is never this screen's to send. */
function detailsOf(form: ChildForm, touched: readonly ChildField[]) {
  const here = form.stage === "here", weeks = amount(form.weeksAtBirth);
  return Object.fromEntries(([
    ["sex", "sex", form.sex || null],
    ["weight", "weight_at_birth_g", here ? gramsOf(form) : undefined],
    ["length", "length_at_birth_cm", here ? cmOf(form) : undefined],
    ["weeksAtBirth", "weeks_at_birth", here ? weeks : undefined],
    ["feeding", "feeding", here ? form.feeding || null : undefined],
    ["doctorName", "doctor", contactFrom(form.doctorName, form.doctorPhone)],
    ["doctorPhone", "doctor", contactFrom(form.doctorName, form.doctorPhone)],
  ] as const).filter(([field, , value]) => touched.includes(field) && value !== undefined).map(([, key, value]) => [key, value])) as ChildDetails;
}

/**
 * A new profile says everything she answered. An edit says only what she touched, nothing worked out by comparing, with
 * null for what she cleared. `touched` is the fields to send: all of them, or those since a create whose answer was lost.
 */
export function childWrite(form: ChildForm, touched: readonly ChildField[], child: Child | undefined, creationId: string, today: Date): { write: Partial<Child> } | { error: string } {
  const name = form.name.trim(), asked = (field: ChildField) => !child || touched.includes(field);
  if (asked("name") && !name) return { error: "Enter a name or nickname. You can change it later." };
  if (asked("due") && form.stage === "expecting" && progressProblem(form)) return { error: progressProblem(form) };
  if ((asked("birth") || asked("stage")) && form.stage === "here" && form.birth > dayKey(today)) return { error: "Pick a birth date on or before today." };
  const fields = child ? touched : (Object.keys(fieldKeys) as ChildField[]),
    problem = measureProblem(form, fields), weeks = amount(form.weeksAtBirth);
  if (problem) return { error: problem };
  if (fields.includes("weeksAtBirth") && form.stage === "here" && weeks !== null && !(Number.isInteger(weeks) && weeks >= 20 && weeks <= 45))
    return { error: "Enter weeks at birth as a whole number from 20 to 45." };
  if ((fields.includes("doctorName") || fields.includes("doctorPhone")) && contactProblem(form.doctorName, form.doctorPhone))
    return { error: contactProblem(form.doctorName, form.doctorPhone) };
  const answers = detailsOf(form, fields);
  if (!child) {
    const given = Object.fromEntries(Object.entries(answers).filter(([, value]) => value !== null)) as ChildDetails;
    return { write: { id: creationId, name, birth_date: form.stage === "expecting" ? null : form.birth || null, due_date: form.due || null,
      ...(Object.keys(given).length ? { details: given } : {}) } };
  }
  const has = (field: ChildField) => touched.includes(field),
    birth = has("stage") && form.stage === "expecting" ? { birth_date: null }
      : has("birth") ? { birth_date: form.birth || null }
        // Today's starting date is what choosing Baby's here means, unless there's a real date already.
        : has("stage") && form.stage === "here" && !child.birth_date && form.birth ? { birth_date: form.birth } : {};
  return { write: {
    id: child.id,
    ...(has("name") ? { name } : {}),
    ...birth,
    ...(has("due") ? { due_date: form.due || null } : {}),
    ...(Object.keys(answers).length ? { details: answers } : {}),
    revision: child.revision,
  } };
}
export const changesAnything = (write: Partial<Child>) => Object.keys(write).some((key) => key !== "id" && key !== "revision");

/** Only into the generation that captured it, and never once the space isn't active: a late answer can't undo a fence. */
export const sameSpace = (state: DeviceState, generation: number) => state.bootstrap?.generation === generation && state.bootstrap.active !== false;
export function withChildDraft(state: DeviceState, slot: string, draft: ChildDraft | null, generation: number): DeviceState {
  if (!sameSpace(state, generation)) return state;
  const { [slot]: _, ...others } = state.childDrafts ?? {};
  return { ...state, childDrafts: draft ? { ...others, [slot]: draft } : others };
}

/** Nothing is queued for a profile, so it says that, and the form keeps what she typed. */
export function saveProblem(failure: unknown) {
  return failure instanceof ApiError && failure.status === 0
    ? "You’re offline, so this isn’t saved yet. What you typed is still here. Try again when you’re connected."
    : failure instanceof ApiError && failure.status === 409
      ? "This profile changed on another phone. Check it, then save again."
      : messageFor(failure);
}

/** The line under a baby's name in Settings. */
export function babyDetailLine(child: Child) {
  const when = child.birth_date ? `Born ${friendlyDate(child.birth_date)}` : child.due_date ? `Due ${friendlyDate(child.due_date)}` : "Add a due date or birth date",
    sex = child.details?.sex;
  return sex ? `${when} · ${sex === "girl" ? "Girl" : "Boy"}` : when;
}

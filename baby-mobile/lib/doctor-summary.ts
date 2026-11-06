import { birthWords } from "./growth-chart";
import { contactWords } from "./contacts";
import type { CareContact } from "./models";
import type { BabyApi } from "./api";
import { basedOn, type CareStats, type StatsDay } from "./care-stats";
import { duration, weightText } from "./care-format";
import { secondsWords } from "./contractions";
import { kindWord, type BabyRecord, type Child, type DeviceState, type Kind } from "./models";
import { mutationRecordId, pendingRecords } from "./outbox";
import { clockIn, dayRange, keyDate, recordDay } from "./tracker";
import { moreKinds, trackerFor } from "./trackers";

/** A page holds a month of daily rows and still has room for the rest. */
export const summaryMaxDays = 31;
const careKinds: readonly Kind[] = ["feeding", "sleep", "diaper", "contraction", "kick_session"],
  pageLimit = 100, pagesLimit = 20;

const time = (iso: string) => new Date(iso).getTime();
const newest = (x: BabyRecord, y: BabyRecord) => time(y.occurred_at) - time(x.occurred_at);

/** Questions, however old, and in these dates: notes on care logs and journal entries. */
function entriesIn(all: BabyRecord[], childId: string | null, first: string, last: string, timezone?: string | null) {
  const { from } = dayRange(first, timezone), { to } = dayRange(last, timezone),
    inRange = (row: BabyRecord) => time(row.occurred_at) >= time(from) && time(row.occurred_at) < time(to),
    forBaby = (row: BabyRecord) => !childId ? !row.child_id : row.child_id === childId || !row.child_id,
    isNote = (row: BabyRecord) => trackerFor(row)?.id === "note";
  return {
    questions: all.filter((row) => row.kind === "question" && forBaby(row)).sort(newest),
    // A log with no baby isn't this baby's, unlike a general note.
    logNotes: all.filter((row) => (careKinds.includes(row.kind) || isNote(row)) && row.child_id === childId && inRange(row) && !!row.body.trim()).sort(newest),
    journal: all.filter((row) => row.kind === "journal" && forBaby(row) && inRange(row)).sort(newest),
    // Only this baby's: a log with no baby is hers, or a removed baby's, and neither belongs on this page.
    logs: all.filter((row) => !!childId && row.child_id === childId && moreKinds.includes(row.kind) && !isNote(row) && inRange(row)).sort(newest),
    her: all.filter((row) => !row.child_id && trackerFor(row)?.about === "her" && inRange(row)).sort(newest),
  };
}

/** The same, from only what this phone holds and has queued. It needs no network, and may not be everything. */
export const localEntries = (state: DeviceState, childId: string | null, first: string, last: string, timezone?: string | null) =>
  entriesIn(pendingRecords(state), childId, first, last, timezone);

/** More than a summary can read. Better no full page than one quietly missing a note she'd want the doctor to see. */
export class SummaryTooLong extends Error {}

/** All of it, from the API. Queued changes count, as they do on the Day view. */
export async function summaryEntries(api: Pick<BabyApi, "records">, state: DeviceState, childId: string | null, first: string, last: string, timezone?: string | null) {
  const { from } = dayRange(first, timezone), { to } = dayRange(last, timezone), rows: BabyRecord[] = [];
  const read = async (filters: Parameters<BabyApi["records"]>[0], tooLong: string) => {
    for (let page = 0; page < pagesLimit; page++) {
      const response = await api.records({ ...filters, limit: pageLimit, offset: page * pageLimit || undefined });
      rows.push(...response.items);
      if (!response.has_more) return;
    }
    throw new SummaryTooLong(tooLong);
  };
  // Questions aren't limited by the dates, so fewer days wouldn't help with those.
  await read({ kinds: ["question"], child_id: childId, include_general: true },
    "You have more questions saved than a summary can hold. Remove some you no longer need, then try again.");
  await read({ kinds: [...careKinds, ...moreKinds, "journal"], child_id: childId, include_general: true, occurred_from: from, occurred_to: to },
    "There are more entries in these days than a summary can hold, so some notes would be left out. Choose fewer days.");
  const changed = new Set(state.outbox.map(mutationRecordId)),
    queued = pendingRecords(state).filter((row) => changed.has(row.id));
  return entriesIn([...rows.filter((row) => !changed.has(row.id)), ...queued], childId, first, last, timezone);
}

const escape = (text: string) => text.replace(/[&<>"']/g, (mark) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[mark]!);
const shortDay = (key: string) => keyDate(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const longDay = (key: string) => keyDate(key).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const bottle = (oz: number, ml: number) => [oz && `${oz} oz`, ml && `${ml} mL`].filter(Boolean).join(", ");

const logged = (day: StatsDay) => day.feeding.count + day.diapers.count + day.sleep.total_minutes + day.contractions.count + day.kicks.sessions > 0;
/** A blank cell means nothing logged there, never a zero, and a column nobody has isn't drawn. */
const shownIf = (value: number, text: string | number = value) => (value ? String(text) : "");
const columns: { title: string; cell: (day: StatsDay) => string }[] = [
  { title: "Feeds", cell: (day) => shownIf(day.feeding.count) },
  { title: "L / R / both", cell: (day) => shownIf(day.feeding.left + day.feeding.right + day.feeding.both, `${day.feeding.left} / ${day.feeding.right} / ${day.feeding.both}`) },
  { title: "Breast min", cell: (day) => shownIf(day.feeding.breast_minutes, Math.round(day.feeding.breast_minutes)) },
  { title: "Bottle", cell: (day) => bottle(day.feeding.bottle_oz, day.feeding.bottle_ml) },
  { title: "Pee", cell: (day) => shownIf(day.diapers.pee) },
  { title: "Poo", cell: (day) => shownIf(day.diapers.poo) },
  { title: "Dry", cell: (day) => shownIf(day.diapers.dry) },
  { title: "Sleep", cell: (day) => shownIf(day.sleep.total_minutes, duration(day.sleep.total_minutes)) },
  { title: "Longest", cell: (day) => shownIf(day.sleep.longest_minutes, duration(day.sleep.longest_minutes)) },
  { title: "Contractions", cell: (day) => shownIf(day.contractions.count) },
  { title: "Avg length", cell: (day) => (day.contractions.average_seconds === null ? "" : secondsWords(day.contractions.average_seconds)) },
  { title: "Kick sessions", cell: (day) => shownIf(day.kicks.sessions) },
  { title: "Movements", cell: (day) => shownIf(day.kicks.movements) },
];
function dayTable(days: StatsDay[]) {
  const rows = days.filter(logged), shown = columns.filter((column) => rows.some((day) => column.cell(day)));
  if (!rows.length) return `<p>Nothing logged in these days.</p>`;
  return `<table><thead><tr><th class="day">Day</th>${shown.map((column) => `<th>${column.title}</th>`).join("")}</tr></thead><tbody>${rows.map((day) =>
    `<tr><td class="day">${shortDay(day.date)}${day.partial ? " (so far)" : ""}</td>${shown.map((column) => `<td>${escape(column.cell(day))}</td>`).join("")}</tr>`).join("")}</tbody></table>${
    rows.length < days.length ? `<p class="small">Days with nothing logged are left out: ${plural(days.length - rows.length, "day")} of ${days.length}.</p>` : ""}`;
}

function totals(stats: CareStats) {
  const { feeding, diapers, sleep, contractions, kicks } = stats, lines: string[] = [];
  if (feeding.count) lines.push([`<b>Feeding:</b> ${plural(feeding.count, "feed")}`,
    feeding.average_per_day !== null && `${feeding.average_per_day} a day (${basedOn(feeding.days_logged, feeding.days_total)})`,
    feeding.average_gap_minutes !== null && `${duration(feeding.average_gap_minutes)} apart on average, start to start`,
    feeding.left + feeding.right + feeding.both > 0 && `left ${feeding.left}, right ${feeding.right}, both ${feeding.both}`,
    feeding.bottle_count > 0 && `${plural(feeding.bottle_count, "bottle")}${bottle(feeding.bottle_oz, feeding.bottle_ml) ? `: ${bottle(feeding.bottle_oz, feeding.bottle_ml)}` : ""}`,
    feeding.timed_breast_feeds > 0 && `${duration(feeding.breast_minutes)} of breastfeeding over ${plural(feeding.timed_breast_feeds, "timed feed")}`].filter(Boolean).join("; "));
  if (diapers.count) lines.push([`<b>Diapers:</b> ${plural(diapers.count, "diaper")} (${diapers.pee} pee, ${diapers.poo} poo, ${diapers.dry} dry)`,
    diapers.average_per_day !== null && `${diapers.average_per_day} a day (${basedOn(diapers.days_logged, diapers.days_total)})`].filter(Boolean).join("; "));
  if (sleep.total_minutes) lines.push([`<b>Sleep:</b> ${duration(sleep.total_minutes)} in all`,
    sleep.average_minutes_per_day !== null && `${duration(sleep.average_minutes_per_day)} a day (${basedOn(sleep.days_logged, sleep.days_total)})`,
    `longest stretch ${duration(sleep.longest_minutes)}`].filter(Boolean).join("; "));
  if (contractions.count) lines.push(`<b>Contractions:</b> ${contractions.count}${contractions.average_seconds === null ? "" : `; about ${secondsWords(contractions.average_seconds)} long on average`}`);
  if (kicks.sessions) lines.push(`<b>Kick counts:</b> ${plural(kicks.sessions, "session")}, ${plural(kicks.movements, "movement")}`);
  return lines.map((line) => `<p>${line}</p>`).join("");
}

export interface SummaryPage {
  /** None means a page of only her questions and notes, which needs no network. */
  stats: CareStats | null;
  child: Pick<Child, "name" | "birth_date" | "due_date" | "details"> | null;
  /** The full page: its Growth section starts with what setup says at birth. */
  atBirth?: boolean;
  timezone: string;
  prepared: Date;
  questions: BabyRecord[];
  /** Journal entries the writer picked, then notes on care logs. A page short of room loses from the end. Nothing private gets here without a tick. */
  notes: BabyRecord[];
  /** This baby's medicine, temperature, growth, pumping, shots and her own custom logs. */
  logs?: BabyRecord[];
  /** What she keeps about herself, as she typed it. After the birth the page is the baby's, so only if she's chosen to add it. */
  her?: BabyRecord[];
}

/** How much a page gives up, in turn, to stay one page: long notes first, then how many it lists. */
const levels = [{ notes: 14, questions: 12, letters: 400 }, { notes: 8, questions: 8, letters: 160 }, { notes: 4, questions: 6, letters: 100 }, { notes: 3, questions: 4, letters: 70 }, { notes: 2, questions: 3, letters: 50 }];
export const lastSummaryLevel = levels.length - 1;

function clipped(text: string, letters: number) {
  const body = text.trim();
  return body.length > letters ? `${body.slice(0, letters).trimEnd()}…` : body;
}
/** A question or note typed straight on a visit takes its first line as its title, so the words needn't be said twice. */
export const repeatsTitle = ({ title, body }: Pick<BabyRecord, "title" | "body">) => {
  const start = title.trim().replace(/…$/, "");
  return !!start && body.trim().startsWith(start);
};
/** What a row on the screen says: the words once, or a title and what's under it. */
export const summaryWords = (row: Pick<BabyRecord, "title" | "body">) => {
  const body = row.body.trim().slice(0, 160);
  return repeatsTitle(row) ? { title: body, detail: "" } : { title: row.title, detail: body };
};
function noteLine(row: BabyRecord, timezone: string, letters: number) {
  const body = clipped(row.body, letters),
    title = row.kind === "journal" || row.kind === "question" ? (repeatsTitle(row) ? "" : row.title.trim()) : row.data.label ?? kindWord(row.kind),
    when = `${shortDay(recordDay(row.occurred_at, timezone))}, ${clockIn(new Date(row.occurred_at), timezone)}`,
    colour = row.kind === "diaper" && row.data.color ? ` (colour: ${row.data.color})` : "",
    from = row.data.provenance === "clinician_instruction" ? " <i>Clinician instruction, labelled by the parent.</i>" : "";
  return `<li><b>${escape(when)}${title ? `, ${escape(title)}` : ""}${colour}.</b> ${escape(body)}${from}</li>`;
}
/** The question, then her notes on it. A title that ends in its own punctuation needs no colon. */
function questionLine(row: BabyRecord, letters: number) {
  const title = repeatsTitle(row) ? "" : row.title.trim(), body = clipped(row.body, letters);
  return title && body ? `${title}${/[?!.:]$/.test(title) ? " " : ": "}${body}` : title || body;
}
function listSection<T>(title: string, rows: T[], limit: number, line: (row: T) => string) {
  if (!rows.length) return "";
  const left = rows.length - limit;
  return `<h2>${title}</h2><ul>${rows.slice(0, limit).map(line).join("")}</ul>${left > 0 ? `<p class="small">${plural(left, "more entry", "more entries")} not on this page.</p>` : ""}`;
}

const loggedAt = (row: BabyRecord, timezone: string) => `${shortDay(recordDay(row.occurred_at, timezone))}, ${clockIn(new Date(row.occurred_at), timezone)}`;
/** A logged line: when, what, and any note on it, in full words and every one escaped. */
const logLine = (row: BabyRecord, timezone: string, letters: number, what: string) => {
  const note = clipped(row.body, letters);
  return `<li><b>${escape(loggedAt(row, timezone))}.</b> ${escape(what)}${note ? `. ${escape(note)}` : ""}</li>`;
};
type LogData = Record<string, any>;
const measures = (d: LogData) => [typeof d.weight === "number" && weightText(d.weight, d.weight_unit), typeof d.length === "number" && `${d.length} ${d.length_unit}`, typeof d.head === "number" && `head ${d.head} ${d.head_unit}`].filter(Boolean).join(", ");
/** One line a day for pumping. An amount in oz and one in mL stay apart, as they do for bottles. */
function pumpingDays(rows: BabyRecord[], timezone: string) {
  const days = new Map<string, { sessions: number; oz: number; ml: number }>();
  for (const row of rows) {
    const key = recordDay(row.occurred_at, timezone), day = days.get(key) ?? { sessions: 0, oz: 0, ml: 0 }, d = row.data as LogData;
    day.sessions++;
    if (typeof d.amount === "number") { if (d.unit === "oz") day.oz += d.amount; else day.ml += d.amount; }
    days.set(key, day);
  }
  return [...days].map(([key, day]) => ({ key, ...day }));
}
function logSections(logs: BabyRecord[], timezone: string, limit: { notes: number; letters: number }, birth: string[] = []) {
  const of = (kind: BabyRecord["kind"]) => logs.filter((row) => row.kind === kind),
    custom = of("custom"), shots = custom.filter((row) => trackerFor(row)?.id === "shot"), others = custom.filter((row) => !shots.includes(row));
  return [
    listSection("Medicine", of("medicine"), limit.notes, (row) => { const d = row.data as LogData; return logLine(row, timezone, limit.letters, [d.name, d.dose].filter(Boolean).join(", ")); }),
    listSection("Temperature", of("temperature"), limit.notes, (row) => { const d = row.data as LogData; return logLine(row, timezone, limit.letters, [`${d.value} °${d.unit === "c" ? "C" : "F"}`, d.method].filter(Boolean).join(", ")); }),
    // First, and past the limit: it's the one a doctor has nowhere else, and only ever one line.
    listSection("Growth", [...(birth.length ? [birth] : []), ...of("growth")], limit.notes + (birth.length ? 1 : 0), (row) => "kind" in row
      ? logLine(row, timezone, limit.letters, measures(row.data as LogData)) : `<li><b>At birth.</b> ${escape(row.join(", "))}</li>`),
    listSection("Pumping", pumpingDays(of("pumping"), timezone), limit.notes, (day) => `<li><b>${escape(shortDay(day.key))}.</b> ${escape([plural(day.sessions, "session"), day.oz && `${Math.round(day.oz * 10) / 10} oz`, day.ml && `${Math.round(day.ml)} mL`].filter(Boolean).join(", "))}</li>`),
    // A name and a date: its noon is only how the date is stored.
    listSection("Shots", shots, limit.notes, (row) => `<li><b>${escape(row.title)}</b> ${escape(longDay(recordDay(row.occurred_at, timezone)))}</li>`),
    listSection("Other logs", others, limit.notes, (row) => { const d = row.data as LogData; return logLine(row, timezone, limit.letters, [d.label, row.title !== d.label && row.title, typeof d.value === "number" && `${d.value}${d.unit ? ` ${d.unit}` : ""}`].filter((part) => part !== false && part !== undefined && part !== "").join(": ")); }),
  ].join("");
}
/** Whether a full page will open its Growth section with the birth measurement, for the same line. */
export const atBirthWords = (child: Pick<Child, "birth_date" | "details"> | null | undefined, logs: BabyRecord[], timezone?: string | null) =>
  (child && birthWords(child, logs, timezone).length ? "measurements at birth" : "");
/** What else a full page will carry, in a line for the screen. */
export function logCounts(logs: BabyRecord[]) {
  const shot = (row: BabyRecord) => trackerFor(row)?.id === "shot", many = (rows: BabyRecord[], one: string, more = `${one}s`) => (rows.length ? `${rows.length} ${rows.length === 1 ? one : more}` : "");
  return [many(logs.filter((row) => row.kind === "medicine"), "medicine", "medicines"), many(logs.filter((row) => row.kind === "temperature"), "temperature"),
    many(logs.filter((row) => row.kind === "growth"), "growth entry", "growth entries"), many(logs.filter((row) => row.kind === "pumping"), "pumping session"),
    many(logs.filter(shot), "shot"), many(logs.filter((row) => row.kind === "custom" && !shot(row)), "other log")].filter(Boolean).join(" · ");
}
/** Hers, exactly as she typed them. Nothing here says whether a number is high or low. */
const herLine = (row: BabyRecord, timezone: string, letters: number) => {
  const d = row.data as LogData;
  return logLine(row, timezone, letters, `${d.label}: ${typeof d.value === "number" ? `${d.value}${d.unit ? ` ${d.unit}` : ""}` : row.title}`);
};

/** One page, in black on white so it survives a photocopier. No colour, no images, no links out, and every word escaped. */
export function summaryHtml({ stats, child, timezone, prepared, questions, notes, logs = [], her = [], atBirth }: SummaryPage, level = 0) {
  const limit = levels[Math.min(level, lastSummaryLevel)], first = stats?.days[0]?.date, last = stats?.days[stats.days.length - 1]?.date,
    // A month of rows takes the space notes would, so its table gets tighter before any note is cut short.
    tight = !!stats && stats.days.filter(logged).length > 14, what = stats ? "care summary" : "questions and notes";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:10pt/1.32 Helvetica,Arial,sans-serif;color:#000;background:#fff}
h1{font-size:15pt;margin:0}h2{font-size:10.5pt;margin:10pt 0 3pt;padding-bottom:2pt;border-bottom:1pt solid #000}
p{margin:0 0 2.5pt}.small{font-size:8.5pt}.head{margin-bottom:6pt}
table{width:100%;border-collapse:collapse;font-size:${tight ? "7.5pt;line-height:1.15" : "8.5pt"};font-variant-numeric:tabular-nums}
th{text-align:right;font-weight:bold;border-bottom:1pt solid #000;padding:${tight ? ".5pt" : "1pt"} 3pt;vertical-align:bottom}
td{text-align:right;border-bottom:.5pt solid #777;padding:${tight ? ".5pt" : "1pt"} 3pt;white-space:nowrap}
.day{text-align:left;padding-left:0}ul{margin:0;padding-left:12pt}li{margin:0 0 2.5pt}
.foot{margin-top:9pt;font-size:8pt;border-top:.5pt solid #000;padding-top:3pt}
</style></head><body>
<div class="head"><h1>${child?.name ? `${escape(child.name)}: ${what}` : `${what[0].toUpperCase()}${what.slice(1)}`}</h1>
<p>${[child?.birth_date && `Born ${longDay(child.birth_date)}`, !child?.birth_date && child?.due_date && `Due ${longDay(child.due_date)}`].filter(Boolean).map((text) => escape(text as string)).join("")}</p>
<p>${first ? `${escape(longDay(first))} to ${escape(longDay(last!))}. ` : ""}Prepared ${escape(prepared.toLocaleDateString(undefined, { timeZone: timezone, month: "long", day: "numeric", year: "numeric" }))}. Times are ${escape(timezone)}.</p></div>
${stats ? `<h2>Totals</h2>${totals(stats) || "<p>Nothing logged in these days.</p>"}
<h2>Day by day</h2>${dayTable(stats.days)}` : `<p class="small">Care totals aren’t on this page.</p>`}
${logSections(logs, timezone, limit, atBirth && child ? birthWords(child, logs, timezone) : [])}
${listSection(child?.birth_date ? "Mom" : "Her own logs", her, limit.notes, (row) => herLine(row, timezone, limit.letters))}
${listSection("Questions for the doctor", questions, limit.questions, (row) => `<li>${escape(questionLine(row, limit.letters))}</li>`)}
${listSection("Notes", notes, limit.notes, (row) => noteLine(row, timezone, limit.letters))}
<p class="foot">Kept by the family in Håfa Baby. Personal records selected by the account owner. This is not a medical assessment.</p>
</body></html>`;
}

/** A file name with the dates and no name of a person, since it can end up anywhere. */
export const summaryFileName = (first: string, last: string, what = "care-summary") => `${what}-${first}-to-${last}.pdf`;
/** The doctor she chose to name, under the page's heading. It's only on the page if she asked. */
export const withDoctor = (html: string, doctor: CareContact | null) =>
  doctor ? html.replace("</h1>", () => `</h1><p>For ${escape(contactWords(doctor))}</p>`) : html;

import type { BabyRecord, DeviceState, EditorDraft, EventCategory, EventEdit, EventException, EventOccurrence, EventOverrides, EventRecurrence, RecordData, RecordWrite } from "./models";
import { mutationRecordIds, pendingRecords } from "./outbox";
import { addDays, clockIn, keyDate, recordDay, zonedInstant, zoneParts } from "./tracker";

export const eventCategories: { value: EventCategory; label: string }[] = [
  { value: "appointment", label: "Appointment" }, { value: "family", label: "Family" }, { value: "celebration", label: "Celebration" },
  { value: "milestone", label: "Milestone" }, { value: "reminder", label: "Reminder" }, { value: "other", label: "Other" },
];
export const categoryName = (category?: EventCategory | null) => eventCategories.find((item) => item.value === category)?.label ?? "Other";
/** The kinds she named, ready in one tap. Birthdays come round again by themselves. */
export const quickEvents: { title: string; category: EventCategory; timed?: boolean; repeat?: EventRecurrence }[] = [
  { title: "Appointment", category: "appointment", timed: true }, { title: "Baptism", category: "celebration" },
  { title: "Birthday", category: "celebration", repeat: { frequency: "yearly", interval: 1 } }, { title: "Family visit", category: "family" },
];

type Series = Pick<BabyRecord, "id" | "title" | "occurred_at" | "child_id" | "data" | "revision">;
const day = 24 * 60 * 60_000;
const ms = (iso: string) => new Date(iso).getTime(), iso = (at: number) => new Date(at).toISOString();
export const midnight = (key: string, zone?: string | null) => zonedInstant(key, 0, 0, zone).getTime();
const keyParts = (key: string) => key.split("-").map(Number);
const dayGap = (from: string, to: string) => {
  const [a, b, c] = keyParts(from), [x, y, z] = keyParts(to);
  return Math.round((Date.UTC(x, y - 1, z) - Date.UTC(a, b - 1, c)) / day);
};
const pad = (value: number) => String(value).padStart(2, "0");
const utcKey = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** The date of occurrence `n`, always from the first one, so a Jan 31 monthly repeat is Feb 28 and then Mar 31. */
function nthDay(anchor: string, { frequency, interval = 1 }: EventRecurrence, n: number) {
  const [year, month, date] = keyParts(anchor);
  if (frequency === "daily" || frequency === "weekly") return utcKey(new Date(Date.UTC(year, month - 1, date + interval * n * (frequency === "weekly" ? 7 : 1))));
  const months = year * 12 + month - 1 + interval * n * (frequency === "monthly" ? 1 : 12), y = Math.floor(months / 12), m = months % 12;
  return utcKey(new Date(Date.UTC(y, m, Math.min(date, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()))));
}
function firstIndex(anchor: string, { frequency, interval = 1 }: EventRecurrence, earliest: string) {
  const [ay, am] = keyParts(anchor), [ey, em] = keyParts(earliest);
  const gap = frequency === "daily" || frequency === "weekly" ? Math.floor(dayGap(anchor, earliest) / (interval * (frequency === "weekly" ? 7 : 1)))
    : frequency === "monthly" ? Math.floor(((ey - ay) * 12 + em - am) / interval) : Math.floor((ey - ay) / interval);
  return Math.max(0, gap - 1);
}
/** Whether counting from `anchor` gives this date. */
function fallsOn(anchor: string, rule: EventRecurrence, key: string) {
  if (key < anchor) return false;
  for (let n = firstIndex(anchor, rule, key); ; n++) {
    const date = nthDay(anchor, rule, n);
    if (date >= key) return date === key;
  }
}
/**
 * The series' original starts with lo <= start < hi, by the API's rule: each keeps the first one's clock time on the
 * event's own calendar, so a 9 AM appointment stays at 9 AM across a clock change. A first one in the hour a clock
 * change repeats keeps which of the two it was, on each later day that hour repeats. It counts from the rule's anchor.
 */
function startsBetween(start: string, data: RecordData, lo: number, hi: number) {
  const first = ms(start), rule = data.recurrence, zone = data.timezone;
  if (!rule) return first >= lo && first < hi ? [first] : [];
  const firstDay = recordDay(start, zone), anchor = rule.anchor || firstDay, earliest = recordDay(iso(lo), zone), found: number[] = [];
  let clock = { hour: 0, minute: 0 };
  try { clock = zoneParts(new Date(first), zone!); } catch { const local = new Date(first); clock = { hour: local.getHours(), minute: local.getMinutes() }; }
  const second = zonedInstant(firstDay, clock.hour, clock.minute, zone).getTime() < first - first % 60_000;
  for (let n = firstIndex(anchor, rule, earliest > firstDay ? earliest : firstDay); ; n++) {
    const date = nthDay(anchor, rule, n);
    if (date < firstDay) continue;
    if (rule.until && date > rule.until) break;
    const moment = date === firstDay ? first : zonedInstant(date, clock.hour, clock.minute, zone, second).getTime() + first % 60_000;
    if (moment >= hi) break;
    if (moment >= lo) found.push(moment);
  }
  return found;
}
const isStart = (start: string, data: RecordData, moment: number) => startsBetween(start, data, moment, moment + 1).includes(moment);
const changeAt = (data: RecordData, original: number) => (data.exceptions ?? []).find((item) => ms(item.original_start) === original);

/** The occurrence the rule gave at `original`, with its change applied, in the shape the API returns. */
function shaped(row: Series, original: number, change?: EventException): EventOccurrence {
  const { data } = row, zone = data.timezone, wasAllDay = !!data.all_day, span = data.end ? ms(data.end) - ms(row.occurred_at) : null,
    days = wasAllDay && data.end ? dayGap(recordDay(row.occurred_at, zone), recordDay(data.end, zone)) : 1,
    changes: EventOverrides = change?.overrides ?? {};
  let begin = original, allDay = wasAllDay,
    end = wasAllDay ? midnight(addDays(recordDay(iso(original), zone), days), zone) : span !== null ? original + span : null;
  if (Object.keys(changes).length) {
    begin = changes.start ? ms(changes.start) : original;
    allDay = changes.all_day ?? wasAllDay;
    const moved = recordDay(iso(begin), zone), oneDay = midnight(addDays(moved, 1), zone);
    if (changes.end) end = ms(changes.end);
    else if ("end" in changes) end = allDay ? oneDay : null;
    else if (changes.start) end = allDay ? midnight(addDays(moved, wasAllDay ? days : 1), zone) : span !== null && !wasAllDay ? begin + span : null;
  }
  return { event_id: row.id, original_start: iso(original), occurrence_start: iso(begin), occurrence_end: end === null ? null : iso(end), all_day: allDay,
    timezone: zone ?? "", title: changes.title ?? row.title, category: changes.category === undefined ? data.category ?? null : changes.category,
    location: changes.location === undefined ? data.location ?? null : changes.location, attendees: changes.attendees ?? data.attendees ?? [],
    child_id: row.child_id, repeats: !!data.recurrence, changed: Object.keys(changes).length > 0, revision: row.revision };
}

/** First and last calendar day it touches: an all-day event on its own calendar, others on the family's. */
export function occurrenceDays(item: EventOccurrence, timeZone?: string | null) {
  const zone = item.all_day ? item.timezone : timeZone, start = ms(item.occurrence_start),
    last = item.occurrence_end && ms(item.occurrence_end) > start ? ms(item.occurrence_end) - 1 : start;
  return [recordDay(iso(start), zone), recordDay(iso(last), zone)] as const;
}
const byStart = (a: EventOccurrence, b: EventOccurrence) =>
  ms(a.occurrence_start) - ms(b.occurrence_start) || a.event_id.localeCompare(b.event_id) || ms(a.original_start) - ms(b.original_start);

/** One event's occurrences on these days, worked out as the API does. For queued changes, and for when the API can't be reached. */
export function eventOccurrences(row: Series, first: string, last: string, timeZone?: string | null) {
  const lo = midnight(first, timeZone), hi = midnight(addDays(last, 1), timeZone), { data } = row,
    reach = (data.end ? ms(data.end) - ms(row.occurred_at) : 0) + 2 * day,
    inRange = (item: EventOccurrence) => { const [a, b] = occurrenceDays(item, timeZone); return a <= last && b >= first; },
    changes = data.exceptions ?? [],
    regular = startsBetween(row.occurred_at, data, lo - reach, hi + 2 * day).filter((at) => !changeAt(data, at)).map((at) => shaped(row, at)),
    moved = changes.filter((item) => item.overrides && isStart(row.occurred_at, data, ms(item.original_start))).map((item) => shaped(row, ms(item.original_start), item));
  return [...regular, ...moved].filter(inRange).sort(byStart);
}
/** The showing she opened. A date the event no longer has falls back to its start. */
export function occurrenceAt(row: Series, at?: string | null) {
  const original = at ? ms(at) : NaN, change = changeAt(row.data, original);
  return Number.isFinite(original) && isStart(row.occurred_at, row.data, original) && !change?.cancelled ? shaped(row, original, change) : shaped(row, ms(row.occurred_at));
}

/**
 * What's on these days. The API answers for events this phone hasn't changed. `local` are those it has, for as long as
 * the screen is up, so a change doesn't flicker while the next answer is on its way. With no answer at all, it's this phone's copy.
 */
export function visibleEvents(state: DeviceState, remote: readonly EventOccurrence[] | undefined, local: ReadonlySet<string>, gone: ReadonlySet<string>,
  childId: string | null, first: string, last: string, timeZone?: string | null) {
  const answered = (remote ?? []).filter((item) => !local.has(item.event_id) && !gone.has(item.event_id)),
    worked = pendingRecords(state).filter((row) => row.kind === "event" && !gone.has(row.id) && (!remote || local.has(row.id)) && (!childId || !row.child_id || row.child_id === childId))
      .flatMap((row) => eventOccurrences(row, first, last, timeZone));
  return [...answered, ...worked].sort(byStart);
}
export function eventsByDay(items: readonly EventOccurrence[], first: string, last: string, timeZone?: string | null) {
  const days = new Map<string, EventOccurrence[]>();
  for (const item of items) {
    const [a, b] = occurrenceDays(item, timeZone);
    for (let key = a > first ? a : first; key <= b && key <= last; key = addDays(key, 1)) days.set(key, [...(days.get(key) ?? []), item]);
  }
  return days;
}
/** A visit with no end stays up for a while after it starts, because she's still in the room. */
const visitGrace = 3 * 60 * 60_000;
export function nextEvent(items: readonly EventOccurrence[], now: Date, timeZone?: string | null) {
  const today = recordDay(now.toISOString(), timeZone);
  return items.find((item) => item.all_day ? occurrenceDays(item, timeZone)[1] >= today
    : (item.occurrence_end ? ms(item.occurrence_end) : ms(item.occurrence_start) + visitGrace) > now.getTime());
}

export function dayName(key: string, today: string) {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  return keyDate(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) });
}
/** "Sat, Nov 21 · 10:00 AM", "Today · All day", "Sat, Nov 21 to Mon, Nov 23". */
export function eventWhen(item: EventOccurrence, today: string, timeZone?: string | null) {
  const [first, last] = occurrenceDays(item, timeZone);
  if (first !== last) return `${dayName(first, today)} to ${dayName(last, today)}`;
  if (item.all_day) return `${dayName(first, today)} · All day`;
  const start = clockIn(new Date(item.occurrence_start), timeZone);
  return `${dayName(first, today)} · ${item.occurrence_end ? `${start} to ${clockIn(new Date(item.occurrence_end), timeZone)}` : start}`;
}
/** What a timeline row leads with on this day. */
export function eventClock(item: EventOccurrence, key: string, timeZone?: string | null) {
  if (item.all_day) return "All day";
  return occurrenceDays(item, timeZone)[0] < key ? "Earlier" : clockIn(new Date(item.occurrence_start), timeZone);
}
export const eventCount = (count: number) => `${count} event${count === 1 ? "" : "s"}`;
/** A day in time order: logs as they're already sorted, timed events among them, and all-day events first either way. */
export function dayTimeline(rows: readonly BabyRecord[], events: readonly EventOccurrence[], newest: boolean) {
  const whole = events.filter((item) => item.all_day), timed = events.filter((item) => !item.all_day), merged: (BabyRecord | EventOccurrence)[] = [...rows];
  for (const item of newest ? [...timed].reverse() : timed) {
    const at = merged.findIndex((row) => "occurred_at" in row && (newest ? ms(row.occurred_at) <= ms(item.occurrence_start) : ms(row.occurred_at) >= ms(item.occurrence_start)));
    merged.splice(at < 0 ? merged.length : at, 0, item);
  }
  return [...whole, ...merged];
}
export function repeatName(rule?: EventRecurrence | null) {
  if (!rule) return "Doesn’t repeat";
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[rule.frequency], every = rule.interval ?? 1;
  return every > 1 ? `Every ${every} ${unit}s` : `Every ${unit}`;
}

export function newEvent(id: string, child: string | null, key: string, timeZone: string): EditorDraft {
  return { id, kind: "event", title: "", body: "", child_id: child, occurred_at: iso(midnight(key, timeZone)), files: [],
    data: { all_day: true, timezone: timeZone, category: "other", attendees: [] } };
}
/** A new start. An end keeps its distance from it. */
export function startingAt(draft: EditorDraft, start: string): Partial<EditorDraft> {
  const whole = new Date(start);
  whole.setSeconds(0, 0);
  const moved = draft.data.all_day ? ms(start) : whole.getTime(), by = moved - ms(draft.occurred_at);
  return { occurred_at: iso(moved), data: { ...draft.data, ...(draft.data.end ? { end: iso(ms(draft.data.end) + by) } : {}) } };
}
/** To all day it starts at that midnight; back to a time it's 9 AM until she says otherwise. Any end no longer means the same. */
export function allDayChanged(draft: EditorDraft, allDay: boolean): Partial<EditorDraft> {
  const zone = draft.data.timezone, key = recordDay(draft.occurred_at, zone);
  return { occurred_at: iso(allDay ? midnight(key, zone) : zonedInstant(key, 9, 0, zone).getTime()), data: { ...draft.data, all_day: allDay, end: null } };
}
/** A tapped kind fills in what it can, and leaves anything she chose after it alone. */
export function quickEvent(draft: EditorDraft, title: string): Partial<EditorDraft> {
  const pick = quickEvents.find((item) => item.title === title)!, was = quickEvents.find((item) => item.title === draft.title),
    timing = pick.timed && draft.data.all_day ? allDayChanged(draft, false) : {};
  return { title, ...timing, data: { ...draft.data, ...timing.data, category: pick.category, ...(pick.repeat ? { recurrence: pick.repeat } : was?.repeat ? { recurrence: null } : {}) } };
}
/** A new day for a new event, at the same time of day. */
export function onNewDay(draft: EditorDraft, key: string): EditorDraft {
  const zone = draft.data.timezone;
  if (draft.data.all_day) return { ...draft, occurred_at: iso(midnight(key, zone)) };
  const clock = zoneParts(new Date(draft.occurred_at), zone!);
  return { ...draft, occurred_at: iso(zonedInstant(key, clock.hour, clock.minute, zone).getTime()) };
}

const seriesOf = ({ title, body, child_id, occurred_at, data }: BabyRecord): NonNullable<EditorDraft["event_edit"]>["series"] => ({ title, body, child_id, occurred_at, data });
/**
 * An editor on one showing of a repeating event. "one" shows it as it is, and only what one date can hold is editable.
 * "future" shows the series from that date on, as the rule gives it, and keeps everything else `data` holds.
 */
export function occurrenceDraft(row: BabyRecord, at: string, scope: "one" | "future"): Pick<EditorDraft, "title" | "occurred_at" | "data" | "event_edit"> {
  const original = ms(at), edit = { scope, original_start: iso(original), series: seriesOf(row) };
  if (scope === "future") {
    const regular = shaped(row, original);
    return { title: row.title, occurred_at: regular.occurrence_start, data: { ...row.data, end: row.data.end ? regular.occurrence_end : null }, event_edit: edit };
  }
  const shown = shaped(row, original, changeAt(row.data, original));
  return { title: shown.title, occurred_at: shown.occurrence_start, data: { ...row.data, all_day: shown.all_day, category: shown.category, location: shown.location, end: null }, event_edit: edit };
}
const placeOf = (data: RecordData) => data.location?.trim() || null;
/** The API refuses a first date that doesn't lead to the start, so a moved start or a new repeat counts afresh. */
function withFittingAnchor(data: RecordData, start: string): RecordData {
  const rule = data.recurrence;
  if (!rule?.anchor || fallsOn(rule.anchor, rule, recordDay(start, data.timezone))) return data;
  const { anchor: _, ...kept } = rule;
  return { ...data, recurrence: kept };
}
/** What the next series counts from: the old one's first date if she kept its date and repeat and the rule clamped this one. */
function continuedRule(data: RecordData, start: string, original: number, series: EventEdit["series"]): RecordData {
  const rule = data.recurrence, was = series.data.recurrence, zone = data.timezone, day = recordDay(start, zone), { anchor: _, ...plain } = rule ?? ({} as EventRecurrence);
  if (!rule) return data;
  const first = was?.anchor || recordDay(series.occurred_at, series.data.timezone),
    same = !!was && was.frequency === rule.frequency && (was.interval ?? 1) === (rule.interval ?? 1) && day === recordDay(iso(original), zone);
  return { ...data, recurrence: same && keyParts(first)[2] !== keyParts(day)[2] ? { ...plain, anchor: first } : plain };
}
/** The change to keep for one date: what differs from how it was showing, on top of any change it already had. */
function oneDateData({ title, occurred_at, data }: EditorDraft, { original_start, series }: NonNullable<EditorDraft["event_edit"]>): RecordData {
  const original = ms(original_start), prior = changeAt(series.data, original), was = shaped({ ...series, id: "", revision: 0 }, original, prior), changes: EventOverrides = {};
  if (title.trim() !== was.title) changes.title = title.trim();
  if (!!data.all_day !== was.all_day) changes.all_day = !!data.all_day;
  if (ms(occurred_at) !== ms(was.occurrence_start) || changes.all_day !== undefined) changes.start = occurred_at;
  if ((data.category ?? null) !== was.category) changes.category = data.category ?? null;
  if (placeOf(data) !== (was.location ?? null)) changes.location = placeOf(data);
  const overrides = { ...prior?.overrides, ...changes }, others = (series.data.exceptions ?? []).filter((item) => ms(item.original_start) !== original);
  return { ...series.data, exceptions: Object.keys(overrides).length ? [...others, { original_start, cancelled: false, overrides }] : others };
}
/** The series up to the day before this date. A change to an earlier date stays, as `end-series` keeps it. */
function seriesEnding(series: Pick<BabyRecord, "data">, original: number): RecordData {
  const zone = series.data.timezone, until = addDays(recordDay(iso(original), zone), -1);
  return { ...series.data, recurrence: { ...series.data.recurrence!, until },
    exceptions: (series.data.exceptions ?? []).filter((item) => recordDay(item.original_start, zone) <= until) };
}
const fromFirst = ({ original_start, series }: NonNullable<EditorDraft["event_edit"]>) => ms(original_start) === ms(series.occurred_at);
/**
 * What saving does to this event's own record. PATCH replaces `data`, so each of these starts from all of it, which is
 * what keeps `exceptions` and `reminder_minutes`. "All future" from a later date ends this series, and `splitEvent` starts the next.
 */
export function eventWrite(draft: EditorDraft): EditorDraft {
  const clean = { ...draft, title: draft.title.trim(), data: withFittingAnchor({ ...draft.data, location: placeOf(draft.data) }, draft.occurred_at) }, edit = draft.event_edit;
  if (!edit) return clean;
  if (edit.scope === "one") return { ...clean, ...edit.series, data: oneDateData(draft, edit) };
  return fromFirst(edit) ? clean : { ...clean, ...edit.series, data: seriesEnding(edit.series, ms(edit.original_start)) };
}
/** Moving a whole repeat from its first date: changes to single dates belong to the old dates, so they don't come along. */
export function movesAwayFromDateChanges(draft: EditorDraft) {
  const edit = draft.event_edit;
  return edit?.scope === "future" && fromFirst(edit) && ms(draft.occurred_at) !== ms(edit.original_start) && !!edit.series.data.exceptions?.length;
}
/** "All future" moved to before the date it changes from: the old series keeps those dates, so they would show twice. */
export function startsBeforeSplit(draft: EditorDraft) {
  const edit = draft.event_edit, zone = draft.data.timezone;
  return edit?.scope === "future" && !fromFirst(edit) && recordDay(draft.occurred_at, zone) < recordDay(edit.original_start, zone);
}
/** The series that takes over from that date. A change to a date it still has moves with it. */
export function splitEvent(draft: EditorDraft, id: string): RecordWrite | undefined {
  const edit = draft.event_edit;
  if (edit?.scope !== "future" || fromFirst(edit)) return undefined;
  const original = ms(edit.original_start), data = continuedRule({ ...draft.data, location: placeOf(draft.data) }, draft.occurred_at, original, edit.series);
  return { id, kind: "event", title: draft.title.trim(), body: draft.body, child_id: draft.child_id, occurred_at: draft.occurred_at,
    data: { ...data, exceptions: data.recurrence ? (edit.series.data.exceptions ?? []).filter((item) => ms(item.original_start) >= original && isStart(draft.occurred_at, data, ms(item.original_start))) : [] } };
}
/** Taking one date off a repeating event. */
export function withoutDate(row: BabyRecord, at: string): BabyRecord {
  const original = ms(at), others = (row.data.exceptions ?? []).filter((item) => ms(item.original_start) !== original);
  return { ...row, data: { ...row.data, exceptions: [...others, { original_start: iso(original), cancelled: true, overrides: null }] } };
}
/** Taking this date and all later ones off. Null when that's every date, which is deleting the event. */
export function withoutFuture(row: BabyRecord, at: string): BabyRecord | null {
  return ms(at) <= ms(row.occurred_at) ? null : { ...row, data: seriesEnding(row, ms(at)) };
}
/** Whether the API would take one more repeating event: this one, and the series a split would start. */
export function seriesFull(rows: readonly BabyRecord[], draft: EditorDraft) {
  if (!draft.data.recurrence) return false;
  const others = rows.filter((row) => row.kind === "event" && row.id !== draft.id && row.data.recurrence).length;
  return others + (draft.event_edit?.scope === "future" && !fromFirst(draft.event_edit) ? 1 : 0) >= 200;
}
/** The phone's copy of the events, as just read. With the whole list, one that's gone from it is gone. */
export function withEventRows(state: DeviceState, rows: readonly BabyRecord[], complete: boolean): DeviceState {
  const fresh = new Map(rows.map((row) => [row.id, row])), held = state.records.filter((row) => row.kind === "event"),
    same = held.length === rows.length && held.every((row) => fresh.get(row.id)?.revision === row.revision);
  if (same) return state;
  const queued = new Set(state.outbox.flatMap((change) => (change.type === "save" || change.type === "delete" || change.type === "event_split" ? mutationRecordIds(change) : [])));
  return { ...state, records: [...rows, ...state.records.filter((row) => !fresh.has(row.id) && (row.kind !== "event" || !complete || queued.has(row.id)))]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) };
}

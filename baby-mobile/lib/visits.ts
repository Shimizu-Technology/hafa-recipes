import { nextEvent } from "./events";
import type { BabyRecord, DeviceState, EditorDraft, EventOccurrence, Kind, RecordData, RecordWrite } from "./models";
import { addDays, recordDay, zonedInstant, zoneParts } from "./tracker";

export type Visit = Pick<BabyRecord, "id" | "child_id"> & Partial<Pick<BabyRecord, "space_id" | "occurred_at" | "data">>;
const firstLine = (text: string) => {
  const line = [...text.trim().split("\n")[0].trim()];
  return line.length > 60 ? line.slice(0, 59).join("").trimEnd() + "…" : line.join("");
};
const newest = (a: BabyRecord, b: BabyRecord) => b.occurred_at.localeCompare(a.occurred_at);
export const visitQuestions = (rows: readonly BabyRecord[], id: string) => rows.filter((row) => row.kind === "question" && row.data.event_id === id).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
export const visitNotes = (rows: readonly BabyRecord[], id: string) => rows.filter((row) => row.kind === "journal" && row.data.event_id === id && row.data.provenance === "clinician_instruction").sort(newest);
/** A question or note about one baby can't sit on another's visit. General ones fit any, and any fits a family one, as the API has it. */
export const fitsVisit = (row: Pick<BabyRecord, "child_id" | "space_id">, visit: Pick<BabyRecord, "child_id" | "space_id">) =>
  row.space_id === visit.space_id && (!row.child_id || !visit.child_id || row.child_id === visit.child_id);
export const looseQuestions = (rows: readonly BabyRecord[], visit?: Pick<BabyRecord, "child_id" | "space_id">) =>
  rows.filter((row) => row.kind === "question" && !row.data.event_id && (!visit || fitsVisit(row, visit))).sort(newest);
/** A record moved to a baby its visit isn't for comes off the visit, and stays in Journal. Null, because the API keeps a link that's only left out. */
export function withFittingVisit<T extends Pick<BabyRecord, "child_id" | "data" | "space_id">>(draft: T, rows: readonly BabyRecord[]): T {
  const visit = draft.data.event_id ? rows.find((row) => row.id === draft.data.event_id) : undefined;
  return visit && !fitsVisit(draft, visit) ? { ...draft, data: { ...draft.data, event_id: null } } : draft;
}
export const questionWords = (row: Pick<BabyRecord, "title" | "body">) => row.body.trim() || row.title;

/** What's half-typed on an appointment, outlasting its screen. By account, and in memory only, so it goes when the app closes. */
const heldWords = new Map<string, Record<string, string>>();
export const heldDrafts = (key: string) => heldWords.get(key) ?? {};
export function holdDraft(key: string, target: string, text: string) {
  const next = { ...heldDrafts(key), [target]: text };
  heldWords.set(key, next);
  return next;
}

const heldVisibility = new Map<string, Record<string, boolean>>();
export const heldChoices = (key: string) => heldVisibility.get(key) ?? {};
export function holdChoice(key: string, target: string, shared: boolean) {
  const next = { ...heldChoices(key), [target]: shared };
  heldVisibility.set(key, next);
  return next;
}

function written(id: string, kind: Kind, text: string, visit: Visit, data: RecordData): RecordWrite {
  return { id, kind, title: firstLine(text), body: text.trim(), child_id: visit.child_id, occurred_at: new Date().toISOString(), data: { ...data, event_id: visit.id } };
}
export const newQuestion = (id: string, text: string, visit: Visit) => written(id, "question", text, visit, {});
/** What the doctor said is hers, in her words, and it's labelled as an instruction she was given. */
export const newVisitNote = (id: string, text: string, visit: Visit) => written(id, "journal", text, visit, { provenance: "clinician_instruction" });

/** The next appointment, which may not be the next event. */
export function nextAppointment(items: readonly EventOccurrence[], now: Date, timeZone?: string | null) {
  return nextEvent(items.filter((item) => item.category === "appointment"), now, timeZone);
}
/** The appointment after this one, for "when's your next". */
export function visitAfter(items: readonly EventOccurrence[], shown: EventOccurrence) {
  return items.find((item) => item.category === "appointment" && new Date(item.occurrence_start).getTime() > new Date(shown.occurrence_start).getTime());
}
/** How far ahead Book next starts. She's told the real date in the room, and it's the first thing on the form to change. */
const bookAhead = 14;
/**
 * The next visit, filled in from this one: same name, place, time of day, length and reminders, for the same person.
 * Its note, its repeat and its questions stay behind, because they belong to this visit.
 */
export function nextVisitDraft(id: string, row: BabyRecord, shown: EventOccurrence): EditorDraft {
  const zone = row.data.timezone, day = addDays(recordDay(shown.occurrence_start, zone), bookAhead), clock = zoneParts(new Date(shown.occurrence_start), zone!),
    start = zonedInstant(day, shown.all_day ? 0 : clock.hour, shown.all_day ? 0 : clock.minute, zone).getTime(),
    length = !shown.all_day && shown.occurrence_end ? new Date(shown.occurrence_end).getTime() - new Date(shown.occurrence_start).getTime() : 0;
  return { id, kind: "event", title: shown.title, body: "", child_id: row.child_id, occurred_at: new Date(start).toISOString(), files: [],
    data: { timezone: zone, all_day: shown.all_day, category: "appointment", location: shown.location, attendees: shown.attendees, end: length ? new Date(start + length).toISOString() : null,
      ...(row.data.reminder_minutes !== undefined ? { reminder_minutes: row.data.reminder_minutes } : {}) } };
}
/** What this phone keeps of what `belongs` to a read, as just read. Same rule as events: a row gone from a whole list is gone. */
export function withVisitRows(state: DeviceState, belongs: (row: BabyRecord) => boolean, rows: readonly BabyRecord[], complete: boolean): DeviceState {
  const fresh = new Map(rows.map((row) => [row.id, row])), held = state.records.filter(belongs),
    same = rows.every((row) => held.some((known) => known.id === row.id && known.revision === row.revision)) && (!complete || held.length === rows.length);
  if (same) return state;
  const queued = new Set(state.outbox.flatMap((change) => (change.type === "save" || change.type === "delete" ? [change.record.id] : [])));
  return { ...state, records: [...rows, ...state.records.filter((row) => !fresh.has(row.id) && (!belongs(row) || !complete || queued.has(row.id)))]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) };
}

/** Captures obey the chosen space. Personal questions cannot keep a family baby link. */
export function visitCapture(state: DeviceState, id: string, kind: "question" | "journal", text: string, visit: Visit, shared: boolean): RecordWrite {
  const boot = state.bootstrap!, event = state.records.find((row) => row.id === visit.id) ?? visit,
    space = event.space_id ?? boot.personal_space_id, family = boot.spaces?.find((one) => one.id === space && one.kind === "family");
  if (family?.role === "caregiver" && (shared || kind === "question")) throw Error("Keep your own note in Journal instead.");
  if (boot.spaces?.length && !event.space_id) throw Error("Open this visit before saving. Your words are still here.");
  if (event.space_id && !boot.spaces?.some((one) => one.id === event.space_id)) throw Error("This visit is no longer available. Your words are still here.");
  const privateFamily = !!family && !shared, result = kind === "question" ? newQuestion(id, text, { ...event, child_id: visit.child_id }) : newVisitNote(id, text, { ...event, child_id: visit.child_id });
  const baby = boot.children?.find((child) => child.id === result.child_id), privateQuestion = privateFamily && kind === "question";
  return privateFamily ? { ...result, kind, ...(privateQuestion ? { child_id: baby && baby.space_id === boot.personal_space_id ? baby.id : null, title: baby ? `Question for ${baby.name}` : result.title } : {}),
    occurred_at: privateVisitAt(visit.occurred_at ?? event.occurred_at ?? result.occurred_at, { ...event.data, ...visit.data }, boot.profile.timezone), data: { ...result.data, event_id: null, just_me: true } } : result;
}

/** All-day dates belong to the event zone; noon in the profile zone puts the private journal on that same day. */
export function privateVisitAt(at: string, data: RecordData | undefined, profileZone: string) {
  return data?.all_day && data.timezone ? zonedInstant(recordDay(at, data.timezone), 12, 0, profileZone).toISOString() : at;
}

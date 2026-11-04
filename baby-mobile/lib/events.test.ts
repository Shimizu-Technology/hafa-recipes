import { describe, expect, it } from "vitest";
import { allDayChanged, dayName, dayTimeline, eventOccurrences, eventsByDay, eventWhen, eventWrite, newEvent, nextEvent, occurrenceAt, occurrenceDraft, onNewDay, quickEvent, seriesFull, splitEvent, startingAt, visibleEvents, withEventRows, withoutDate, withoutFuture } from "./events";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type EditorDraft, type EventOccurrence, type Mutation, type RecordData } from "./models";
import { pendingRecords } from "./outbox";

const guam = "Pacific/Guam";
const event = (id: string, occurred_at: string, data: RecordData, extra: Partial<BabyRecord> = {}): BabyRecord =>
  ({ ...optimisticRecord({ id, kind: "event", title: "Class", body: "", child_id: null, occurred_at, data: { timezone: guam, ...data } }), revision: 3, ...extra });
const seen = (rows: readonly EventOccurrence[]) => rows.map((item) => [item.original_start, item.occurrence_start, item.occurrence_end, item.all_day, item.title, item.location]
  .map((part) => (typeof part === "string" && /^\d{4}-/.test(part) ? new Date(part).getTime() : part)));
/** Printed by the API's own `occurrences_of` for these events, so this phone and the service can't drift apart unnoticed. */
const fromApi: Record<string, { start: string; data: RecordData; got: (string | boolean | null)[][]; first: string; last: string }> = {"monthEnd":{"start":"2027-01-31T09:00:00+10:00","data":{"timezone":"Pacific/Guam","recurrence":{"frequency":"monthly","interval":1}},"got":[["2027-01-31T09:00:00+10:00","2027-01-31T09:00:00+10:00",null,false,"T",null],["2027-02-28T09:00:00+10:00","2027-02-28T09:00:00+10:00",null,false,"T",null],["2027-03-31T09:00:00+10:00","2027-03-31T09:00:00+10:00",null,false,"T",null],["2027-04-30T09:00:00+10:00","2027-04-30T09:00:00+10:00",null,false,"T",null],["2027-05-31T09:00:00+10:00","2027-05-31T09:00:00+10:00",null,false,"T",null],["2027-06-30T09:00:00+10:00","2027-06-30T09:00:00+10:00",null,false,"T",null],["2027-07-31T09:00:00+10:00","2027-07-31T09:00:00+10:00",null,false,"T",null],["2027-08-31T09:00:00+10:00","2027-08-31T09:00:00+10:00",null,false,"T",null],["2027-09-30T09:00:00+10:00","2027-09-30T09:00:00+10:00",null,false,"T",null],["2027-10-31T09:00:00+10:00","2027-10-31T09:00:00+10:00",null,false,"T",null],["2027-11-30T09:00:00+10:00","2027-11-30T09:00:00+10:00",null,false,"T",null],["2027-12-31T09:00:00+10:00","2027-12-31T09:00:00+10:00",null,false,"T",null],["2028-01-31T09:00:00+10:00","2028-01-31T09:00:00+10:00",null,false,"T",null],["2028-02-29T09:00:00+10:00","2028-02-29T09:00:00+10:00",null,false,"T",null]],"first":"2026-10-01","last":"2029-03-14"},"dst":{"start":"2027-03-07T09:30:15+00:00","data":{"timezone":"America/New_York","recurrence":{"frequency":"weekly","interval":1},"end":"2027-03-07T10:30:15+00:00"},"got":[["2027-03-07T04:30:15-05:00","2027-03-07T04:30:15-05:00","2027-03-07T05:30:15-05:00",false,"T",null],["2027-03-14T04:30:15-04:00","2027-03-14T04:30:15-04:00","2027-03-14T05:30:15-04:00",false,"T",null],["2027-03-21T04:30:15-04:00","2027-03-21T04:30:15-04:00","2027-03-21T05:30:15-04:00",false,"T",null],["2027-03-28T04:30:15-04:00","2027-03-28T04:30:15-04:00","2027-03-28T05:30:15-04:00",false,"T",null],["2027-04-04T04:30:15-04:00","2027-04-04T04:30:15-04:00","2027-04-04T05:30:15-04:00",false,"T",null],["2027-04-11T04:30:15-04:00","2027-04-11T04:30:15-04:00","2027-04-11T05:30:15-04:00",false,"T",null]],"first":"2026-10-01","last":"2027-04-14"},"gap":{"start":"2027-03-07T07:30:00+00:00","data":{"timezone":"America/New_York","recurrence":{"frequency":"daily","interval":7}},"got":[["2027-03-07T02:30:00-05:00","2027-03-07T02:30:00-05:00",null,false,"T",null],["2027-03-14T03:30:00-04:00","2027-03-14T03:30:00-04:00",null,false,"T",null],["2027-03-21T02:30:00-04:00","2027-03-21T02:30:00-04:00",null,false,"T",null],["2027-03-28T02:30:00-04:00","2027-03-28T02:30:00-04:00",null,false,"T",null],["2027-04-04T02:30:00-04:00","2027-04-04T02:30:00-04:00",null,false,"T",null],["2027-04-11T02:30:00-04:00","2027-04-11T02:30:00-04:00",null,false,"T",null]],"first":"2026-10-01","last":"2027-04-14"},"leap":{"start":"2028-02-29T00:00:00+10:00","data":{"timezone":"Pacific/Guam","all_day":true,"recurrence":{"frequency":"yearly","interval":1}},"got":[["2028-02-29T00:00:00+10:00","2028-02-29T00:00:00+10:00","2028-03-01T00:00:00+10:00",true,"T",null],["2029-02-28T00:00:00+10:00","2029-02-28T00:00:00+10:00","2029-03-01T00:00:00+10:00",true,"T",null]],"first":"2026-10-01","last":"2029-03-14"},"exceptions":{"start":"2026-11-02T10:00:00+10:00","data":{"timezone":"Pacific/Guam","recurrence":{"frequency":"weekly","interval":2,"until":"2027-01-31"},"end":"2026-11-02T11:00:00+10:00","exceptions":[{"original_start":"2026-11-16T00:00:00Z","cancelled":true},{"original_start":"2026-11-30T00:00:00Z","overrides":{"start":"2026-12-01T02:00:00Z","title":"Moved","location":"Clinic"}},{"original_start":"2026-12-14T00:00:00Z","overrides":{"all_day":true,"start":"2026-12-13T14:00:00Z"}},{"original_start":"2026-12-28T00:00:00Z","overrides":{"end":null}}]},"got":[["2026-11-02T10:00:00+10:00","2026-11-02T10:00:00+10:00","2026-11-02T11:00:00+10:00",false,"T",null],["2026-11-30T10:00:00+10:00","2026-12-01T12:00:00+10:00","2026-12-01T13:00:00+10:00",false,"Moved","Clinic"],["2026-12-14T10:00:00+10:00","2026-12-14T00:00:00+10:00","2026-12-15T00:00:00+10:00",true,"T",null],["2026-12-28T10:00:00+10:00","2026-12-28T10:00:00+10:00",null,false,"T",null],["2027-01-11T10:00:00+10:00","2027-01-11T10:00:00+10:00","2027-01-11T11:00:00+10:00",false,"T",null],["2027-01-25T10:00:00+10:00","2027-01-25T10:00:00+10:00","2027-01-25T11:00:00+10:00",false,"T",null]],"first":"2026-10-01","last":"2027-04-14"},"multiDay":{"start":"2026-12-24T00:00:00+10:00","data":{"timezone":"Pacific/Guam","all_day":true,"end":"2026-12-27T00:00:00+10:00","recurrence":{"frequency":"yearly","interval":1}},"got":[["2026-12-24T00:00:00+10:00","2026-12-24T00:00:00+10:00","2026-12-27T00:00:00+10:00",true,"T",null],["2027-12-24T00:00:00+10:00","2027-12-24T00:00:00+10:00","2027-12-27T00:00:00+10:00",true,"T",null],["2028-12-24T00:00:00+10:00","2028-12-24T00:00:00+10:00","2028-12-27T00:00:00+10:00",true,"T",null]],"first":"2026-10-01","last":"2029-03-14"}};

describe("working out occurrences as the API does", () => {
  it.each(Object.keys(fromApi))("%s", (name) => {
    const { start, data, got, first, last } = fromApi[name],
      rows = eventOccurrences({ id: "e", title: "T", child_id: null, revision: 1, occurred_at: start, data }, first, last, "UTC");
    expect(seen(rows).slice(0, got.length)).toEqual(seen(got.map(([original_start, occurrence_start, occurrence_end, all_day, title, location]) =>
      ({ original_start, occurrence_start, occurrence_end, all_day, title, location }) as EventOccurrence)));
  });
  it("finds a repeat begun long ago without walking from its start", () => {
    const rows = eventOccurrences(event("old", "2001-01-01T00:00:00Z", { recurrence: { frequency: "daily" } }), "2026-12-01", "2026-12-03", guam);
    expect(rows).toHaveLength(3);
  });
  it("stops at the repeat's last day, on the event's calendar", () => {
    const rows = eventOccurrences(event("e", "2026-11-02T00:00:00Z", { recurrence: { frequency: "weekly", until: "2026-11-16" } }), "2026-11-01", "2026-12-31", guam);
    expect(rows.map((item) => item.occurrence_start)).toEqual(["2026-11-02T00:00:00.000Z", "2026-11-09T00:00:00.000Z", "2026-11-16T00:00:00.000Z"]);
  });
  it("places an all-day event on its own calendar day, wherever the family's clock is", () => {
    const row = event("e", "2026-11-20T14:00:00Z", { all_day: true }), [item] = eventOccurrences(row, "2026-11-20", "2026-11-22", guam);
    expect([...eventsByDay([item], "2026-11-01", "2026-11-30", "America/New_York").keys()]).toEqual(["2026-11-21"]);
  });
  it("shows a multi-day event on each day, clipped to the range", () => {
    const row = event("e", "2026-12-23T14:00:00Z", { all_day: true, end: "2026-12-26T14:00:00Z" }), items = eventOccurrences(row, "2026-12-01", "2026-12-31", guam);
    expect([...eventsByDay(items, "2026-12-25", "2026-12-31", guam).keys()]).toEqual(["2026-12-25", "2026-12-26"]);
  });
});

describe("what a screen shows", () => {
  const remote = (id: string, at: string): EventOccurrence => ({ event_id: id, original_start: at, occurrence_start: at, occurrence_end: null, all_day: false, timezone: guam, title: "From API", category: null, location: null, attendees: [], child_id: null, repeats: false, changed: false, revision: 1 });
  const state = (records: BabyRecord[], outbox: Mutation[] = []) => ({ ...emptyState(), records, outbox }) as DeviceState;
  const save = (record: BabyRecord): Mutation => ({ id: "m-" + record.id, generation: 1, type: "save", record, files: [] });
  const none = new Set<string>();
  it("trusts the API for events this phone hasn't changed", () => {
    const rows = visibleEvents(state([event("a", "2026-12-01T00:00:00Z", {})]), [remote("a", "2026-12-01T00:00:00Z")], none, none, null, "2026-12-01", "2026-12-31", guam);
    expect(rows.map((item) => item.title)).toEqual(["From API"]);
  });
  it("shows an event saved with no signal, before and after a relaunch, from this phone's copy", () => {
    const fresh = state([], [save(event("new", "2026-12-20T00:00:00Z", {}, { title: "Baptism", revision: 0 }))]);
    // A relaunch restores this same state, and the API can't be asked.
    const again = JSON.parse(JSON.stringify(fresh));
    expect(visibleEvents(again, undefined, none, none, null, "2026-12-01", "2026-12-31", guam).map((item) => item.title)).toEqual(["Baptism"]);
  });
  it("keeps a change on screen while the next answer is on its way", () => {
    const moved = event("a", "2026-12-05T00:00:00Z", {}, { title: "Moved" }), rows = visibleEvents(state([moved]), [remote("a", "2026-12-01T00:00:00Z")], new Set(["a"]), none, null, "2026-12-01", "2026-12-31", guam);
    expect(rows.map((item) => [item.title, item.occurrence_start])).toEqual([["Moved", "2026-12-05T00:00:00.000Z"]]);
  });
  it("takes a queued delete off straight away, and one that's just left the queue too", () => {
    const row = event("a", "2026-12-01T00:00:00Z", {}), queued = state([row], [{ id: "d", generation: 1, type: "delete", record: row }]);
    expect(visibleEvents(queued, undefined, none, none, null, "2026-12-01", "2026-12-31", guam)).toEqual([]);
    expect(visibleEvents(state([]), [remote("a", "2026-12-01T00:00:00Z")], none, new Set(["a"]), null, "2026-12-01", "2026-12-31", guam)).toEqual([]);
  });
  it("filters to one baby and the whole family", () => {
    const rows = [event("mine", "2026-12-01T00:00:00Z", {}, { child_id: "baby" }), event("other", "2026-12-02T00:00:00Z", {}, { child_id: "other" }), event("all", "2026-12-03T00:00:00Z", {})];
    expect(visibleEvents(state(rows), undefined, none, none, "baby", "2026-12-01", "2026-12-31", guam).map((item) => item.event_id)).toEqual(["mine", "all"]);
    expect(visibleEvents(state(rows), undefined, none, none, null, "2026-12-01", "2026-12-31", guam)).toHaveLength(3);
  });
  it("keeps a visit up as next while she's in the room, then moves on", () => {
    const visit = remote("v", "2026-12-01T00:00:00Z"), later = remote("l", "2026-12-08T00:00:00Z");
    expect(nextEvent([visit, later], new Date("2026-12-01T01:00:00Z"), guam)?.event_id).toBe("v");
    expect(nextEvent([visit, later], new Date("2026-12-01T04:00:00Z"), guam)?.event_id).toBe("l");
  });
  it("keeps an all-day event as next until its day is over", () => {
    const whole = { ...remote("w", "2026-11-30T14:00:00Z"), all_day: true, occurrence_end: "2026-12-01T14:00:00Z" };
    expect(nextEvent([whole], new Date("2026-12-01T13:00:00Z"), guam)?.event_id).toBe("w");
    expect(nextEvent([whole], new Date("2026-12-01T15:00:00Z"), guam)).toBeUndefined();
  });
  it("says when in plain words", () => {
    const at = remote("a", "2026-12-01T00:00:00Z");
    expect(eventWhen(at, "2026-12-01", guam)).toContain("Today · 10:00");
    expect(eventWhen({ ...at, all_day: true, occurrence_start: "2026-12-01T14:00:00Z", occurrence_end: "2026-12-02T14:00:00Z" }, "2026-12-01", guam)).toBe("Tomorrow · All day");
    expect(dayName("2027-01-05", "2026-12-01")).toContain("2027");
  });
  it("puts a day in order: all-day first, timed among the logs, in either direction", () => {
    const log = (id: string, occurred_at: string) => optimisticRecord({ id, kind: "diaper", title: "", body: "", child_id: "baby", occurred_at, data: { type: "wet" } }),
      morning = log("morning", "2026-12-01T00:00:00Z"), night = log("night", "2026-12-01T10:00:00Z"), visit = remote("visit", "2026-12-01T05:00:00Z"), whole = { ...remote("whole", "2026-11-30T14:00:00Z"), all_day: true },
      ids = (rows: ReturnType<typeof dayTimeline>) => rows.map((row) => ("event_id" in row ? row.event_id : row.id));
    expect(ids(dayTimeline([night, morning], [whole, visit], true))).toEqual(["whole", "night", "visit", "morning"]);
    expect(ids(dayTimeline([morning, night], [whole, visit], false))).toEqual(["whole", "morning", "visit", "night"]);
  });
});

describe("saving an edit", () => {
  const skipped = { original_start: "2026-11-23T00:00:00Z", cancelled: true },
    series = event("s", "2026-11-02T00:00:00Z", { recurrence: { frequency: "weekly" }, reminder_minutes: [60], category: "family", exceptions: [skipped] }),
    draftOn = (at: string, scope: "one" | "future"): EditorDraft => ({ ...series, files: [], existing: true, ...occurrenceDraft(series, at, scope) });
  it("keeps exceptions and reminder_minutes on an ordinary edit, and on one date's change", () => {
    const one = eventWrite({ ...draftOn("2026-11-09T00:00:00Z", "one"), title: "Moved class" });
    expect(one.title).toBe("Class");
    expect(one.occurred_at).toBe(series.occurred_at);
    expect(one.data.reminder_minutes).toEqual([60]);
    expect(one.data.exceptions).toEqual([skipped, { original_start: "2026-11-09T00:00:00.000Z", cancelled: false, overrides: { title: "Moved class" } }]);
    const whole = eventWrite({ ...series, title: "Renamed", files: [], existing: true });
    expect(whole.data).toMatchObject({ reminder_minutes: [60], exceptions: [skipped] });
  });
  it("adds to a date's earlier change rather than replacing it, and leaves a date with no change alone", () => {
    const changed = { ...series, data: { ...series.data, exceptions: [{ original_start: "2026-11-09T00:00:00Z", cancelled: false, overrides: { location: "Clinic" } }] } },
      draft: EditorDraft = { ...changed, files: [], existing: true, ...occurrenceDraft(changed, "2026-11-09T00:00:00Z", "one") };
    expect(draft.data.location).toBe("Clinic");
    expect(eventWrite({ ...draft, title: "New" }).data.exceptions?.[0].overrides).toEqual({ location: "Clinic", title: "New" });
    expect(eventWrite(draftOn("2026-11-16T00:00:00Z", "one")).data.exceptions).toEqual([skipped]);
  });
  it("gives a moved all-day date its start, as the API requires", () => {
    const draft = draftOn("2026-11-09T00:00:00Z", "one"), overrides = eventWrite({ ...draft, ...allDayChanged(draft, true) }).data.exceptions?.at(-1)?.overrides;
    expect(overrides).toEqual({ all_day: true, start: "2026-11-08T14:00:00.000Z" });
  });
  it("All future from the first date edits the series itself", () => {
    const draft = draftOn(series.occurred_at, "future");
    expect(splitEvent(draft, "next")).toBeUndefined();
    expect(eventWrite({ ...draft, title: "Renamed" })).toMatchObject({ title: "Renamed", data: { reminder_minutes: [60], exceptions: [skipped] } });
  });
  it("All future from a later date ends this series and starts the next, and neither loses a thing", () => {
    const draft = { ...draftOn("2026-11-16T00:00:00Z", "future"), title: "New class" }, ended = eventWrite(draft), next = splitEvent(draft, "next")!;
    expect(ended).toMatchObject({ title: "Class", occurred_at: series.occurred_at, data: { reminder_minutes: [60], recurrence: { frequency: "weekly", until: "2026-11-15" }, exceptions: [] } });
    expect(next).toMatchObject({ id: "next", title: "New class", occurred_at: "2026-11-16T00:00:00.000Z", data: { reminder_minutes: [60], category: "family", recurrence: { frequency: "weekly" }, exceptions: [skipped] } });
  });
  it("drops a change whose date the next series no longer has", () => {
    const draft = draftOn("2026-11-16T00:00:00Z", "future"), later = { ...draft, ...startingAt(draft, "2026-11-16T02:00:00.000Z") };
    expect(splitEvent(later, "next")!.data.exceptions).toEqual([]);
    expect(splitEvent({ ...draft, data: { ...draft.data, recurrence: null } }, "next")!.data.exceptions).toEqual([]);
  });
  it("keeps a timed series' length when it splits", () => {
    const long = event("l", "2026-11-02T00:00:00Z", { recurrence: { frequency: "weekly" }, end: "2026-11-02T01:30:00Z" }),
      draft: EditorDraft = { ...long, files: [], existing: true, ...occurrenceDraft(long, "2026-11-16T00:00:00Z", "future") };
    expect(splitEvent(draft, "next")!.data.end).toBe("2026-11-16T01:30:00.000Z");
  });
  it("takes one date off, or that date and all later, or says that's the whole event", () => {
    expect(withoutDate(series, "2026-11-09T00:00:00Z").data.exceptions).toEqual([skipped, { original_start: "2026-11-09T00:00:00.000Z", cancelled: true, overrides: null }]);
    expect(withoutFuture(series, "2026-11-16T00:00:00Z")?.data).toMatchObject({ reminder_minutes: [60], recurrence: { until: "2026-11-15" } });
    expect(withoutFuture(series, series.occurred_at)).toBeNull();
    const after = withoutDate(series, "2026-11-09T00:00:00Z");
    expect(eventOccurrences(after, "2026-11-02", "2026-11-30", guam).map((item) => item.occurrence_start)).toEqual(["2026-11-02T00:00:00.000Z", "2026-11-16T00:00:00.000Z", "2026-11-30T00:00:00.000Z"]);
  });
  it("shows the date she opened, or the first if that date is gone", () => {
    expect(occurrenceAt(series, "2026-11-09T00:00:00Z").occurrence_start).toBe("2026-11-09T00:00:00.000Z");
    expect(occurrenceAt(series, "2026-11-23T00:00:00Z").occurrence_start).toBe("2026-11-02T00:00:00.000Z");
    expect(occurrenceAt(series, "2026-11-10T00:00:00Z").occurrence_start).toBe("2026-11-02T00:00:00.000Z");
  });
  it("counts a split's new series against the limit of 200", () => {
    const rows = Array.from({ length: 199 }, (_, n) => event(`r${n}`, series.occurred_at, { recurrence: { frequency: "daily" } }));
    expect(seriesFull([...rows, series], { ...series, files: [], existing: true })).toBe(false);
    expect(seriesFull([...rows, series], { ...draftOn("2026-11-16T00:00:00Z", "future") })).toBe(true);
    expect(seriesFull([...rows, series, event("one", series.occurred_at, {})], { ...newEvent("n", null, "2026-12-01", guam), data: { timezone: guam, recurrence: { frequency: "daily" } } })).toBe(true);
    expect(seriesFull([...rows, series], newEvent("n", null, "2026-12-01", guam))).toBe(false);
  });
});

describe("filling in a new event", () => {
  const draft = newEvent("n", null, "2026-12-20", guam);
  it("starts as all day on the day she tapped, in the family's clock", () => {
    expect(draft).toMatchObject({ occurred_at: "2026-12-19T14:00:00.000Z", data: { all_day: true, timezone: guam } });
  });
  it("a kind fills in its name and category, an appointment gets a time, and a birthday repeats until she picks something else", () => {
    expect(quickEvent(draft, "Baptism")).toMatchObject({ title: "Baptism", data: { category: "celebration", all_day: true } });
    const visit = { ...draft, ...quickEvent(draft, "Appointment") };
    expect(visit).toMatchObject({ occurred_at: "2026-12-19T23:00:00.000Z", data: { category: "appointment", all_day: false } });
    const birthday = { ...draft, ...quickEvent(draft, "Birthday") };
    expect(birthday.data.recurrence?.frequency).toBe("yearly");
    expect(quickEvent(birthday, "Baptism").data?.recurrence).toBeNull();
  });
  it("picking a time drops the seconds, so each date of a repeat lands exactly", () => {
    const timed = { ...draft, ...allDayChanged(draft, false) };
    expect(startingAt(timed, "2026-12-20T01:02:03.456Z").occurred_at).toBe("2026-12-20T01:02:00.000Z");
  });
  it("moves a kept draft to the day she tapped", () => {
    expect(onNewDay(draft, "2027-01-05").occurred_at).toBe("2027-01-04T14:00:00.000Z");
    const visit = { ...draft, ...quickEvent(draft, "Appointment") };
    expect(onNewDay(visit, "2027-01-05").occurred_at).toBe("2027-01-04T23:00:00.000Z");
  });
});

describe("the phone's copy of events", () => {
  const care = optimisticRecord({ id: "care", kind: "diaper", title: "", body: "", child_id: null, occurred_at: "2026-11-01T00:00:00Z", data: {} });
  it("doesn't write when nothing changed", () => {
    const row = event("a", "2026-12-01T00:00:00Z", {}), state = { ...emptyState(), records: [row, care] } as DeviceState;
    expect(withEventRows(state, [row], true)).toBe(state);
  });
  it("adds new ones and forgets one that's gone, but not other records or a queued one", () => {
    const old = event("gone", "2026-12-01T00:00:00Z", {}), queued = event("queued", "2026-12-02T00:00:00Z", {}), fresh = event("fresh", "2026-12-03T00:00:00Z", {});
    const state = { ...emptyState(), records: [old, queued, care], outbox: [{ id: "m", generation: 1, type: "save", record: queued, files: [] }] } as DeviceState;
    expect(withEventRows(state, [fresh], true).records.map((row) => row.id)).toEqual(["fresh", "queued", "care"]);
    expect(withEventRows(state, [fresh], false).records.map((row) => row.id)).toEqual(["fresh", "queued", "gone", "care"]);
    expect(pendingRecords(withEventRows(state, [fresh], true)).some((row) => row.id === "gone")).toBe(false);
  });
});

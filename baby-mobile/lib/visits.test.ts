import { describe, expect, it } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type EventOccurrence, type RecordData } from "./models";
import { looseQuestions, newQuestion, newVisitNote, nextAppointment, nextVisitDraft, questionWords, visitAfter, visitNotes, visitQuestions, withFittingVisit, withVisitRows } from "./visits";

const guam = "Pacific/Guam", isQuestion = (item: BabyRecord) => item.kind === "question";
const row = (id: string, kind: BabyRecord["kind"], data: RecordData = {}, occurred_at = "2026-11-01T00:00:00Z", body = "") => optimisticRecord({ id, kind, title: id, body, child_id: null, occurred_at, data });
const when = (id: string, at: string, category: EventOccurrence["category"] = "appointment"): EventOccurrence => ({ event_id: id, original_start: at, occurrence_start: at, occurrence_end: null, all_day: false, timezone: guam, title: id, category, location: null, attendees: [], child_id: null, repeats: false, changed: false, revision: 1 });

describe("what belongs to a visit", () => {
  const rows = [row("q1", "question", { event_id: "visit" }, "2026-11-02T00:00:00Z"), row("q2", "question", { event_id: "visit" }, "2026-11-01T00:00:00Z"), row("other", "question", { event_id: "another" }), row("loose", "question"),
    row("said", "journal", { event_id: "visit", provenance: "clinician_instruction" }), row("mine", "journal", { event_id: "visit" }), row("diary", "journal", { provenance: "clinician_instruction" })];
  it("lists its questions in the order she wrote them, and only its own", () => {
    expect(visitQuestions(rows, "visit").map((item) => item.id)).toEqual(["q2", "q1"]);
  });
  it("lists only what the doctor said as after-visit notes", () => {
    expect(visitNotes(rows, "visit").map((item) => item.id)).toEqual(["said"]);
  });
  it("offers only questions on no visit to link", () => {
    expect(looseQuestions(rows).map((item) => item.id)).toEqual(["loose"]);
  });
  it("offers a child's visit that child's questions and general ones, and a family visit any", () => {
    const person = (id: string, child: string | null) => ({ ...row(id, "question"), child_id: child }), mixed = [person("noas", "noa"), person("kais", "kai"), person("general", null)];
    expect(looseQuestions(mixed, { child_id: "noa" }).map((item) => item.id).sort()).toEqual(["general", "noas"]);
    expect(looseQuestions(mixed, { child_id: null })).toHaveLength(3);
  });
  it("lets go of a visit when the question moves to a baby it doesn't fit", () => {
    const visit = { ...row("visit", "event"), child_id: "noa" }, draft = { ...row("q", "question", { event_id: "visit" }), child_id: "kai", files: [], existing: true };
    expect(withFittingVisit(draft, [visit]).data.event_id).toBeNull();
    expect(withFittingVisit({ ...draft, child_id: "noa" }, [visit]).data.event_id).toBe("visit");
    expect(withFittingVisit({ ...draft, child_id: null }, [visit]).data.event_id).toBe("visit");
    expect(withFittingVisit(draft, [{ ...visit, child_id: null }]).data.event_id).toBe("visit");
    expect(withFittingVisit(draft, []).data.event_id).toBe("visit");
  });
  it("reads a question in her whole words", () => {
    expect(questionWords(row("short", "question", {}, undefined, "All of it, however long"))).toBe("All of it, however long");
  });
});
describe("writing for a visit", () => {
  const visit = { id: "visit", child_id: "baby" };
  it("a question carries the event and the baby, and an untitled one is listed by its first words", () => {
    const long = "w".repeat(70), written = newQuestion("q", `  ${long}\nsecond line`, visit);
    expect(written).toMatchObject({ id: "q", kind: "question", child_id: "baby", data: { event_id: "visit" }, body: `${long}\nsecond line` });
    expect([...written.title]).toHaveLength(60);
    expect(written.data.provenance).toBeUndefined();
  });
  it("what the doctor said is a journal entry marked as a clinician instruction", () => {
    expect(newVisitNote("n", "Come back in a week", visit)).toMatchObject({ kind: "journal", title: "Come back in a week", body: "Come back in a week", data: { provenance: "clinician_instruction", event_id: "visit" } });
  });
});
describe("the next visit", () => {
  const items = [when("party", "2026-12-01T00:00:00Z", "family"), when("ob", "2026-12-03T00:00:00Z"), when("later", "2026-12-10T00:00:00Z")];
  it("looks past other events to the next appointment", () => {
    expect(nextAppointment(items, new Date("2026-11-30T00:00:00Z"), guam)?.event_id).toBe("ob");
  });
  it("finds the appointment after this one", () => {
    expect(visitAfter(items, items[1])?.event_id).toBe("later");
    expect(visitAfter(items, items[2])).toBeUndefined();
  });
  it("Book next keeps the name, place, time, length, person and reminders, and leaves the note, repeat and changes behind", () => {
    const source: BabyRecord = { ...optimisticRecord({ id: "ob", kind: "event", title: "OB visit", body: "Private note", child_id: "baby", occurred_at: "2026-11-02T00:00:00Z",
      data: { timezone: guam, category: "appointment", location: "Clinic", recurrence: { frequency: "weekly" }, reminder_minutes: [60], end: "2026-11-02T00:30:00Z", exceptions: [{ original_start: "2026-11-09T00:00:00Z", cancelled: true }] } }), revision: 3 },
      shown = { ...when("ob", "2026-11-16T00:00:00.000Z"), title: "OB visit", location: "Clinic", occurrence_end: "2026-11-16T00:30:00.000Z" },
      draft = nextVisitDraft("new", source, shown);
    expect(draft).toMatchObject({ id: "new", title: "OB visit", body: "", child_id: "baby", occurred_at: "2026-11-30T00:00:00.000Z", data: { location: "Clinic", reminder_minutes: [60], end: "2026-11-30T00:30:00.000Z", category: "appointment", timezone: guam } });
    expect(draft.existing).toBeUndefined();
    expect(draft.data.recurrence).toBeUndefined();
    expect(draft.data.exceptions).toBeUndefined();
  });
  it("Book next from an all-day visit stays all day, at that midnight", () => {
    const source = row("ob", "event", { timezone: guam, all_day: true }), shown = { ...when("ob", "2026-11-15T14:00:00.000Z"), all_day: true, occurrence_end: "2026-11-16T14:00:00.000Z" };
    expect(nextVisitDraft("new", source, shown)).toMatchObject({ occurred_at: "2026-11-29T14:00:00.000Z", data: { all_day: true, end: null } });
  });
});
describe("the phone's copy", () => {
  const state = (records: BabyRecord[], outbox: DeviceState["outbox"] = []) => ({ ...emptyState(), records, outbox }) as DeviceState;
  it("doesn't write when nothing changed", () => {
    const question = row("q", "question"), held = state([question, row("feed", "feeding")]);
    expect(withVisitRows(held, isQuestion, [question], true)).toBe(held);
  });
  it("adds what it read, and forgets only what a whole list shows is gone", () => {
    const fresh = row("fresh", "question"), gone = row("gone", "question"), queued = row("queued", "question"), feed = row("feed", "feeding"),
      held = state([gone, queued, feed], [{ id: "m", generation: 1, type: "save", record: queued, files: [] }]);
    expect(withVisitRows(held, isQuestion, [fresh], true).records.map((item) => item.id).sort()).toEqual(["feed", "fresh", "queued"]);
    expect(withVisitRows(held, isQuestion, [fresh], false).records.map((item) => item.id).sort()).toEqual(["feed", "fresh", "gone", "queued"]);
  });
  it("picks up a link the API took off when its event was deleted", () => {
    const linked = { ...row("q", "question", { event_id: "visit" }), revision: 1 }, cleared = { ...row("q", "question"), revision: 2 };
    expect(looseQuestions(withVisitRows(state([linked]), isQuestion, [cleared], true).records).map((item) => item.id)).toEqual(["q"]);
  });
});
describe("reading one visit's records", () => {
  it("forgets only what was on this visit and isn't any more, and leaves other journal entries alone", () => {
    const belongs = (item: BabyRecord) => item.data.event_id === "visit",
      kept = row("kept", "question", { event_id: "visit" }), gone = row("gone", "journal", { event_id: "visit" }), other = row("diary", "journal"), elsewhere = row("q", "question", { event_id: "other" }),
      held = { ...emptyState(), records: [kept, gone, other, elsewhere] } as DeviceState;
    expect(withVisitRows(held, belongs, [kept], true).records.map((item) => item.id).sort()).toEqual(["diary", "kept", "q"]);
  });
});

import { describe, expect, it } from "vitest";
import { addMutation, deviceVersion, draftsBeforeFamily, fencedState, pendingRecords, retiredSpaces, retryUnavailable, upgradedState, withKnownSpaces } from "./outbox";
import { fenceOf, generationOf, holdsFamilyWork, spaceForNew, unavailableMessage } from "./spaces";
import { emptyState, optimisticRecord, type BabySpace, type Bootstrap, type DeviceState, type Mutation, type RecordData } from "./models";

const personal = "personal-space", family = "family-space";
const own: BabySpace = { id: personal, kind: "personal", role: "parent", generation: 2, access_version: 1 },
  shared: BabySpace = { id: family, kind: "family", role: "parent", generation: 1, access_version: 1 };
const boot = (spaces = [own, shared], extra: Partial<Bootstrap> = {}): Bootstrap => ({ generation: 2, ai_available: false, profile: { display_name: "", timezone: "UTC", ai_consent: false },
  personal_space_id: personal, spaces, children: [{ id: "baby", name: "Baby", revision: 1, space_id: family, generation: 1 }, { id: "mine", name: "Mine", revision: 1, space_id: personal, generation: 2 }], ...extra });
const off = (): Bootstrap => ({ generation: 2, ai_available: false, profile: { display_name: "", timezone: "UTC", ai_consent: false }, children: [{ id: "baby", name: "Baby", revision: 1 }] });
const state = (bootstrap: Bootstrap = boot(), extra: Partial<DeviceState> = {}): DeviceState => ({ ...emptyState(), bootstrap, ...extra });
const write = (id: string, kind: any, child_id: string | null = null, data: RecordData = {}) => ({ id, kind, title: id, body: "", child_id, occurred_at: "2026-11-05T00:00:00.000Z", data });
const save = (id: string, kind: any, child_id: string | null = null, data: RecordData = {}): Mutation => ({ id: "m-" + id, generation: 2, type: "save", files: [], record: write(id, kind, child_id, data) });

describe("where a new entry goes", () => {
  it.each([
    ["care follows its baby into the family", "diaper", "baby", {}, family],
    ["care follows its baby in the personal space", "diaper", "mine", {}, personal],
    ["a journal entry is private, even about a shared baby", "journal", "baby", {}, personal],
    ["a saved post is shared", "source", null, {}, family],
    ["a category is shared", "collection", null, {}, family],
    ["a doctor question is shared", "question", null, {}, family],
    ["an event is shared", "event", null, {}, family],
    ["a list is shared", "routine", null, {}, family],
    ["a saved post chosen as Just me stays personal", "source", null, { just_me: true }, personal],
    ["a journal entry stays personal whatever's set", "journal", null, {}, personal],
    ["her blood pressure is hers, not the family's", "custom", null, { label: "Blood pressure" }, personal],
    ["how she's feeling is hers", "custom", null, { label: "How I'm feeling" }, personal],
    ["her weight is hers", "custom", null, { label: "My weight" }, personal],
    ["her vitamins are hers", "custom", null, { label: "Vitamins and medicine" }, personal],
    ["a custom log she made up with no baby is shared", "custom", null, { label: "Walked" }, family],
    ["a baby's note is shared", "custom", "baby", { label: "Note" }, family],
  ])("%s", (_, kind, child, data, expected) => {
    expect(spaceForNew(state(), write("a", kind, child as string | null, data as RecordData))).toBe(expected);
  });
  it("with no family everything is personal", () => {
    const alone = state(boot([own]));
    expect(spaceForNew(alone, write("a", "source"))).toBe(personal);
    expect(spaceForNew(alone, write("a", "diaper", "mine"))).toBe(personal);
  });
  it("a caregiver's care goes to the family, and what caregivers can't hold goes to their own space", () => {
    const helper = state(boot([own, { ...shared, role: "caregiver" }]));
    expect(spaceForNew(helper, write("a", "diaper", "baby"))).toBe(family);
    expect(spaceForNew(helper, write("a", "event"))).toBe(family);
    expect(spaceForNew(helper, write("a", "source"))).toBe(personal);
    expect(spaceForNew(helper, write("a", "question", "baby"))).toBe(personal);
    expect(spaceForNew(helper, write("a", "custom", null, { label: "My weight" }))).toBe(personal);
  });
  it("has no answer with the flag off, so the write names no space", () => {
    expect(spaceForNew(state(off()), write("a", "diaper", "baby"))).toBeUndefined();
  });
});

describe("queueing", () => {
  it("stamps a new entry with where it's going and that space's generation", () => {
    const [queued] = addMutation(state(), save("a", "diaper", "baby")).outbox;
    expect(queued).toMatchObject({ space_id: family, generation: 1 });
    expect(fenceOf(queued)).toEqual({ generation: 1, space_id: family });
  });
  it("sends her log to the personal space with its generation", () => {
    const [queued] = addMutation(state(), save("a", "custom", null, { label: "Blood pressure" })).outbox;
    expect(queued).toMatchObject({ space_id: personal, generation: 2 });
  });
  it("leaves everything as it is with the flag off", () => {
    const [queued] = addMutation(state(off()), save("a", "diaper", "baby")).outbox;
    expect(queued.space_id).toBeUndefined();
    expect(queued.generation).toBe(2);
    expect(fenceOf(queued)).toBe(2);
  });
  it("an edit stays where its row is, whatever its kind would choose now", () => {
    const row = { ...optimisticRecord(write("a", "source")), space_id: personal, generation: 2 };
    const [queued] = addMutation(state(boot(), { records: [row] }), { ...save("a", "source"), id: "m" }).outbox;
    expect(queued).toMatchObject({ space_id: personal, generation: 2 });
  });
  it("a tap, delete or import goes with its record, even one still queued", () => {
    const first = addMutation(state(), save("a", "feeding", "baby"));
    const tap: Mutation = { id: "t", generation: 2, type: "feed_action", record_id: "a", action: { id: "t", action: "finish", at: "2026-11-05T00:00:00.000Z" } };
    expect(addMutation(first, tap).outbox[1]).toMatchObject({ space_id: family, generation: 1 });
    const row = { ...optimisticRecord(write("b", "diaper")), space_id: family, generation: 1 };
    expect(addMutation(state(boot(), { records: [row] }), { id: "d", generation: 2, type: "delete", record: row }).outbox[0]).toMatchObject({ space_id: family, generation: 1 });
    const imported: Mutation = { id: "i", generation: 2, type: "import", record_id: "a", files: [] };
    expect(addMutation(first, imported).outbox[1]).toMatchObject({ space_id: family, generation: 1 });
  });
  it("a birth date or a switch goes with its baby", () => {
    const birth: Mutation = { id: "b", generation: 2, type: "child_birth", child_id: "baby", birth_date: "2026-12-01", previous: null };
    const switched: Mutation = { id: "s", generation: 2, type: "child_tracking", child_id: "baby", tracking: { sleep: true }, previous: { sleep: null } };
    expect(addMutation(state(), birth).outbox[0]).toMatchObject({ space_id: family, generation: 1 });
    expect(addMutation(state(), switched).outbox[0]).toMatchObject({ space_id: family, generation: 1 });
  });
  it("shows a queued entry with its space straight away", () => {
    expect(pendingRecords(addMutation(state(), save("a", "diaper", "baby")))[0]).toMatchObject({ id: "a", space_id: family });
  });
});

describe("generation by space", () => {
  it("reads each space's own", () => {
    expect(generationOf(boot(), family)).toBe(1);
    expect(generationOf(boot(), personal)).toBe(2);
    expect(generationOf(boot(), undefined)).toBe(2);
    expect(generationOf(boot(), "gone")).toBeUndefined();
  });
  it("with the flag off again every space answers as personal, so a stamped change still goes", () => {
    expect(generationOf(off(), personal)).toBe(2);
  });
});

describe("the fence around pending work", () => {
  const row = (id: string, space_id?: string) => ({ ...optimisticRecord(write(id, "diaper")), ...(space_id ? { space_id } : {}) });
  const queued = (id: string, generation: number, space_id?: string): Mutation => ({ ...save(id, "diaper"), id: "m-" + id, generation, ...(space_id ? { space_id } : {}) });
  const held = () => state(boot(), {
    records: [row("old"), row("mine", personal), row("shared", family)],
    outbox: [queued("old", 2), queued("mine", 2, personal), queued("shared", 1, family)],
    drafts: { a: { id: "a", kind: "journal", title: "t", body: "kept", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {}, files: [] } },
    imports: [{ id: "j", status: "queued" }],
  });
  it("wipes nothing when joining adds a space and nothing else changed", () => {
    const before = state(boot([own]), { records: [row("mine", personal)], outbox: [queued("mine", 2, personal)], drafts: held().drafts, feedTimer: { child_id: "baby", generation: 2, started_at: "t", segments: [] } });
    expect(fencedState(before, boot())).toBe(before);
  });
  it("wipes nothing when the flag turns on or off", () => {
    const before = held();
    expect(fencedState(before, off())).toBe(before);
    expect(fencedState({ ...before, bootstrap: off() }, boot())).toEqual({ ...before, bootstrap: off() });
  });
  it("keeps a family's pending work when only the personal space was cleared", () => {
    const next = fencedState(held(), boot([{ ...own, generation: 3 }, shared], { generation: 3 }));
    expect(next.records.map((r) => r.id)).toEqual(["shared"]);
    expect(next.outbox.map((m) => m.id)).toEqual(["m-shared"]);
    expect(next.drafts).toEqual({});
    expect(next.imports).toEqual([]);
  });
  it("drops only that family's pending work when its generation changes", () => {
    const next = fencedState(held(), boot([own, { ...shared, generation: 2 }]));
    expect(next.records.map((r) => r.id)).toEqual(["old", "mine"]);
    expect(next.outbox.map((m) => m.id)).toEqual(["m-old", "m-mine"]);
    expect(next.drafts).toEqual(held().drafts);
  });
  it("keeps a family's drafts, jobs, baby and file links when only the personal space was cleared", () => {
    const file = { id: "f", uri: "file:///f", name: "f.jpg", mime_type: "image/jpeg" };
    const familyDraft = { id: "fd", kind: "journal" as const, title: "", body: "family words", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {}, files: [file], space_id: family };
    const before = { ...held(), selectedChild: "baby", drafts: { ...held().drafts, "record:fd": familyDraft },
      imports: [{ id: "j", status: "queued", space_id: family }, { id: "k", status: "queued", space_id: personal }], fileUploads: { f: "u", other: "x" },
      childDrafts: { baby: { creation_id: "b" } as never, mine: { creation_id: "m" } as never } };
    const next = fencedState(before, boot([{ ...own, generation: 3 }, shared], { generation: 3 }));
    expect(Object.keys(next.drafts)).toEqual(["record:fd"]);
    expect(next.imports.map((job) => job.id)).toEqual(["j"]);
    expect(next.selectedChild).toBe("baby");
    expect(next.fileUploads).toEqual({ f: "u" });
    expect(Object.keys(next.childDrafts ?? {})).toEqual(["baby"]);
  });
  it("drops a selected personal baby with its space", () => {
    expect(fencedState({ ...held(), selectedChild: "mine" }, boot([{ ...own, generation: 3 }, shared], { generation: 3 })).selectedChild).toBeNull();
  });
  it("still clears it all for a generation with no spaces, as before", () => {
    const next = fencedState({ ...held(), bootstrap: off() }, 3);
    expect(next.records).toEqual([]);
    expect(next.outbox).toEqual([]);
  });
});

describe("drafts from before the family", () => {
  const draft = (id: string, extra: object = {}) => ({ id, kind: "source" as const, title: "", body: "words", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {}, files: [], ...extra });
  it("are personal from the moment a family appears", () => {
    const next = draftsBeforeFamily(state(boot([own]), { drafts: { "new:source": draft("a") } }), boot());
    expect(next.drafts["new:source"]).toMatchObject({ space_id: personal, generation: 2, body: "words" });
  });
  it("leaves one that knows its space", () => {
    const next = draftsBeforeFamily(state(boot(), { drafts: { x: draft("a", { space_id: family, generation: 1 }) } }), boot());
    expect(next.drafts.x).toMatchObject({ space_id: family });
  });
});

describe("spaces this account has quietly lost", () => {
  const row = (space_id: string) => ({ ...optimisticRecord(write("a", "diaper")), space_id });
  it("finds a family's rows, queue and drafts when the API's list doesn't have it, even with no memory of the family", () => {
    const flagOff = state(off(), { records: [row("gone")], outbox: [{ ...save("q", "diaper"), space_id: "also-gone" }],
      drafts: { d: { id: "d", kind: "journal", title: "", body: "", child_id: null, occurred_at: "", data: {}, files: [], space_id: "draft-gone" } } });
    expect(retiredSpaces(flagOff, boot([own]))).toEqual(["gone", "also-gone", "draft-gone"]);
  });
  it("never counts personal, a listed family, or something already stopped", () => {
    const fine = state(boot(), { records: [row(personal), row(family)], outbox: [{ ...save("q", "diaper"), space_id: "left", left_space: "left" }] });
    expect(retiredSpaces(fine, boot())).toEqual([]);
  });
  it("asks nothing of an API that isn't listing spaces", () => {
    expect(retiredSpaces(state(boot(), { records: [row("x")] }), off())).toEqual([]);
  });
});

describe("what an older build mustn't read", () => {
  const row = (space_id: string) => ({ ...optimisticRecord(write("a", "diaper")), space_id });
  it("is a phone with any family work, and nothing else", () => {
    expect(holdsFamilyWork(state(off()))).toBe(false);
    expect(holdsFamilyWork(state(boot([own]), { records: [row(personal)] }))).toBe(false);
    expect(holdsFamilyWork(state(boot()))).toBe(true);
    expect(holdsFamilyWork(state(boot([own]), { outbox: [{ ...save("q", "diaper"), space_id: family, left_space: family }] }))).toBe(true);
    expect(holdsFamilyWork(state(off(), { records: [row(family)] }))).toBe(true);
  });
});

describe("updating from a build with no spaces", () => {
  const taps = (error: string): Mutation => ({ id: "t", generation: 2, type: "feed_action", record_id: "a", action: { id: "t", action: "finish", at: "2026-11-05T00:00:00.000Z" }, error, sent: true });
  const running = { child_id: "baby", generation: 2, started_at: "2026-11-05T00:00:00.000Z", segments: [{ side: "left" as const, started_at: "2026-11-05T00:00:00.000Z" }] };
  const old = (): DeviceState => ({ ...emptyState(), bootstrap: off(), feedTimer: running, selectedChild: "baby",
    records: [optimisticRecord(write("a", "diaper"))], fileUploads: { f: "u" },
    drafts: { d: { id: "d", kind: "journal", title: "draft", body: "typed", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {}, files: [] } },
    outbox: [{ ...save("q", "diaper", "baby") }, { ...save("gone", "diaper"), error: unavailableMessage }] });
  it("keeps drafts, queue, records, uploads and a running timer, and sends a 404'd item again", () => {
    const before = old(), next = upgradedState(before);
    expect(next.version).toBe(deviceVersion);
    expect(next.feedTimer).toEqual(running);
    expect(next.drafts).toEqual(before.drafts);
    expect(next.records).toEqual(before.records);
    expect(next.fileUploads).toEqual({ f: "u" });
    expect(next.selectedChild).toBe("baby");
    expect(next.outbox.map((m) => m.id)).toEqual(["m-q", "m-gone"]);
    expect(next.outbox[1].error).toBeUndefined();
  });
  it("happens once", () => {
    const later = { ...upgradedState(old()), outbox: [{ ...save("gone", "diaper"), error: unavailableMessage }] };
    expect(upgradedState(later)).toBe(later);
  });
  it("leaves a real conflict for review, and only retries what said it was gone", () => {
    const conflict = { ...save("c", "diaper"), error: "Some details need review.", conflict: true };
    expect(retryUnavailable({ ...old(), outbox: [conflict] }).outbox).toEqual([conflict]);
    const birth: Mutation = { id: "b", generation: 2, type: "child_birth", child_id: "baby", birth_date: null, previous: null, error: "This baby’s profile was removed." };
    const tap = taps("This tap couldn’t be added to the feed. It’s safe on this phone.");
    expect(retryUnavailable({ ...old(), outbox: [birth, tap] }).outbox.map((m) => m.error)).toEqual([undefined, undefined]);
  });
  it("gets its space on the first bootstrap that lists them, and stays personal", () => {
    const next = withKnownSpaces(old(), boot());
    expect(next.records[0]).toMatchObject({ space_id: personal, generation: 2 });
    expect(next.outbox[0]).toMatchObject({ space_id: personal, generation: 2 });
  });
  it("does nothing to rows that know their space, or with the flag off", () => {
    const row = { ...optimisticRecord(write("a", "diaper")), space_id: family, generation: 1 };
    const before = state(boot(), { records: [row] });
    expect(withKnownSpaces(before, boot())).toBe(before);
    const legacy = old();
    expect(withKnownSpaces(legacy, off())).toBe(legacy);
  });
});

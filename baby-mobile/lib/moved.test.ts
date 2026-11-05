import { describe, expect, it } from "vitest";
import { keepInPersonal, notSentMessage, pendingRecords, retargeted, rejoined, retryUnavailable, withoutFamily, type Moved } from "./outbox";
import { emptyState, optimisticRecord, type Bootstrap, type DeviceState, type EditorDraft, type Mutation, type RecordData } from "./models";

const personal = "personal-space", family = "family-space";
const boot = (): Bootstrap => ({ generation: 2, ai_available: false, profile: { display_name: "", timezone: "UTC", ai_consent: false }, personal_space_id: personal,
  spaces: [{ id: personal, kind: "personal", role: "parent", generation: 2, access_version: 1 }, { id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }],
  children: [{ id: "baby", name: "Baby", revision: 2, space_id: family, generation: 1 }, { id: "mine", name: "Mine", revision: 1, space_id: personal, generation: 2 }] });
const write = (id: string, kind: any = "diaper", child_id: string | null = null, data: RecordData = { type: "wet" }) => ({ id, kind, title: id, body: "words", child_id, occurred_at: "2026-11-05T00:00:00.000Z", data });
const row = (id: string, revision: number, space_id = personal, extra: object = {}) => ({ ...optimisticRecord(write(id)), revision, space_id, generation: space_id === family ? 1 : 2, ...extra });
const edit = (id: string, revision?: number, extra: object = {}): Mutation => ({ id: "m-" + id, generation: 2, space_id: personal, type: "save", files: [], record: { ...write(id), ...(revision ? { revision } : {}) }, ...extra });
const state = (extra: Partial<DeviceState> = {}): DeviceState => ({ ...emptyState(), bootstrap: boot(), ...extra });
const moved = (over: Partial<Moved> = {}): Moved => ({ space_id: family, generation: 1, revision: 4, record: { ...row("a", 4, family) }, ...over });
let n = 0; const uuid = () => `new-${++n}`;

describe("a write that finds its row moved", () => {
  it("follows the row, and only the move's own revision, so a plain move never asks for review", () => {
    const next = retargeted(state({ records: [row("a", 3)], outbox: [edit("a", 3)] }), edit("a", 3), moved(), uuid);
    expect(next.outbox[0]).toMatchObject({ space_id: family, generation: 1, record: { revision: 4 } });
    expect(next.records[0]).toMatchObject({ id: "a", space_id: family, revision: 4 });
  });
  it("reads the same moment written the API's other way as the same moment", () => {
    const next = retargeted(state({ records: [{ ...row("a", 3), occurred_at: "2026-11-05T07:45:00Z" }], outbox: [edit("a", 3)] }), edit("a", 3),
      moved({ record: { ...row("a", 4, family), occurred_at: "2026-11-05T07:45:00+00:00" } }), uuid);
    expect(next.outbox[0]).toMatchObject({ record: { revision: 4 } });
  });
  it("keeps the old revision if something else changed too, so the API sends it to review", () => {
    const next = retargeted(state({ records: [row("a", 3)], outbox: [edit("a", 3)] }), edit("a", 3), moved({ revision: 5, record: { ...row("a", 5, family), title: "Someone changed this" } }), uuid);
    expect(next.outbox[0]).toMatchObject({ space_id: family, generation: 1, record: { revision: 3 } });
  });
  it("keeps the old revision after more than one step, even if everything reads the same", () => {
    const next = retargeted(state({ records: [row("a", 1)], outbox: [edit("a", 1)] }), edit("a", 1), moved({ revision: 3, record: row("a", 3, family) }), uuid);
    expect(next.outbox[0]).toMatchObject({ space_id: family, record: { revision: 1 } });
  });
  it("sends it to review if the other parent changed a file, a category or a link, so it can't overwrite them", () => {
    const seenData = { type: "wet", attachment_ids: ["their-photo"], record_ids: ["a"], event_id: "visit", suggested_category: { name: "Sleep", status: "pending" } } as RecordData;
    for (const changed of [{ attachment_ids: [] }, { record_ids: [] }, { event_id: "other" }, { suggested_category: null }] as RecordData[]) {
      const seen = row("a", 1, personal, { data: seenData });
      const next = retargeted(state({ records: [seen], outbox: [edit("a", 1)] }), edit("a", 1), moved({ revision: 2, record: row("a", 2, family, { data: { ...seenData, ...changed } }) }), uuid);
      expect(next.outbox[0]).toMatchObject({ space_id: family, record: { revision: 1 } });
    }
  });
  it("doesn't mind Just me changing, which is what a move does", () => {
    const seen = row("a", 1, family, { data: { type: "wet" } });
    const next = retargeted(state({ records: [seen], outbox: [edit("a", 1)] }), edit("a", 1), moved({ space_id: personal, revision: 2, record: row("a", 2, personal, { data: { type: "wet", just_me: true } }) }), uuid);
    expect(next.outbox[0]).toMatchObject({ space_id: personal, record: { revision: 2 } });
  });
  it("doesn't carry an old upload across with an import: it takes the files the moved row has", () => {
    const source = row("a", 1, personal, { kind: "source", data: { attachment_ids: ["personal-upload"] } });
    const imported: Mutation = { id: "i", generation: 2, space_id: personal, type: "import", record_id: "a", attachment_ids: ["personal-upload"], files: [{ id: "f", uri: "file:///f", name: "f.jpg", mime_type: "image/jpeg", uploaded_id: "personal-upload" }] };
    const next = retargeted(state({ records: [source], outbox: [imported], fileUploads: { f: "personal-upload" } }), imported,
      moved({ revision: 2, record: row("a", 2, family, { kind: "source", data: { attachment_ids: ["family-copy"] } }) }), uuid);
    const held = next.outbox[0] as Extract<Mutation, { type: "import" }>;
    expect(held.attachment_ids).toEqual(["family-copy"]);
    expect(held.files[0].uploaded_id).toBeUndefined();
    expect(held.files[0].id).not.toBe("f");
    expect(next.fileUploads).toEqual({});
  });
  it("keeps the old revision if this phone can't tell what changed", () => {
    const next = retargeted(state({ outbox: [edit("a", 3)] }), edit("a", 3), moved(), uuid);
    expect(next.outbox[0]).toMatchObject({ space_id: family, record: { revision: 3 } });
  });
  it("takes later changes to the same row with it, and nothing else", () => {
    const later: Mutation = { ...edit("a", 3), id: "later" }, tap: Mutation = { id: "tap", generation: 2, space_id: personal, type: "feed_action", record_id: "a", action: { id: "tap", action: "finish", at: "2026-11-05T00:00:00.000Z" } };
    const other = edit("b", 1);
    const next = retargeted(state({ records: [row("a", 3)], outbox: [edit("a", 3), later, tap, other] }), edit("a", 3), moved(), uuid);
    expect(next.outbox.map((m) => m.space_id)).toEqual([family, family, family, personal]);
    expect(next.outbox[1]).toMatchObject({ record: { revision: 4 } });
  });
  it("sends new care for a moved baby to the baby's space, as the same create", () => {
    const create = { ...edit("n"), record: write("n", "diaper", "baby") } as Mutation;
    const next = retargeted(state({ outbox: [create] }), create, moved({ revision: 2, record: { id: "baby", name: "Baby", revision: 2 } as never }), uuid);
    expect(next.outbox[0]).toMatchObject({ space_id: family, generation: 1, record: { id: "n" } });
    expect(next.records).toEqual([]);
  });
  it("uploads a file again in the new space, since a record's files must be in its own", () => {
    const withFile = { ...edit("a", 3), files: [{ id: "f", uri: "file:///f", name: "f.jpg", mime_type: "image/jpeg", uploaded_id: "old-upload" }] } as Mutation;
    const next = retargeted(state({ records: [row("a", 3)], outbox: [withFile], fileUploads: { f: "old-upload" } }), withFile, moved(), uuid);
    const files = (next.outbox[0] as Extract<Mutation, { type: "save" }>).files;
    expect(files[0].uploaded_id).toBeUndefined();
    expect(files[0].id).not.toBe("f");
    expect(next.fileUploads).toEqual({});
  });
  it("moves a kept draft on by the same step", () => {
    const draft = { ...write("a"), revision: 3, files: [], existing: true } as EditorDraft;
    const next = retargeted(state({ records: [row("a", 3)], outbox: [edit("a", 3)], drafts: { "record:a": draft } }), edit("a", 3), moved(), uuid);
    expect(next.drafts["record:a"]).toMatchObject({ revision: 4 });
  });
  it("stops following after a few bounces and asks her", () => {
    let next = state({ records: [row("a", 3)], outbox: [edit("a", 3)] });
    for (let i = 0; i < 8; i++) next = retargeted(next, next.outbox[0], moved({ space_id: i % 2 ? family : personal }), uuid);
    expect(next.outbox[0].error).toBeTruthy();
  });
});

describe("leaving a family, or being removed", () => {
  const shared = row("shared", 3, family), mine = row("mine", 1, personal);
  const queued: Mutation = { id: "q", generation: 1, space_id: family, type: "save", files: [], record: write("q", "diaper", "baby") };
  const tap: Mutation = { id: "t", generation: 1, space_id: family, type: "feed_action", record_id: "shared", action: { id: "t", action: "finish", at: "2026-11-05T00:00:00.000Z" } };
  const own: Mutation = { ...edit("mine", 1) };
  const before = () => state({ records: [shared, mine], outbox: [queued, tap, own], selectedChild: "baby",
    imports: [{ id: "j", status: "queued", space_id: family }, { id: "k", status: "queued", space_id: personal }],
    changes: { cursor: { [personal]: 3, [family]: 8 }, access: { [personal]: 1, [family]: 1 } } });
  it("clears the family's rows from this phone and keeps its own", () => {
    const next = withoutFamily(before(), family, uuid);
    expect(next.records.map((r) => r.id)).toEqual(["mine"]);
    expect(next.imports.map((j) => j.id)).toEqual(["k"]);
    expect(next.changes?.cursor).toEqual({ [personal]: 3 });
  });
  it("stops the family's queue and says why, and leaves its own queue alone", () => {
    const next = withoutFamily(before(), family, uuid);
    expect(next.outbox.map((m) => [m.id, m.error, m.left_space])).toEqual([["q", notSentMessage, family], ["t", notSentMessage, family], ["m-mine", undefined, undefined]]);
  });
  it("stops showing what's stopped as if it were still an entry", () => {
    const edited = { ...before(), outbox: [{ id: "q", generation: 1, space_id: family, type: "save" as const, files: [], record: write("new-care", "diaper", "baby") }] };
    expect(pendingRecords(edited).map((r) => r.id)).toContain("new-care");
    expect(pendingRecords(withoutFamily(edited, family, uuid)).map((r) => r.id)).not.toContain("new-care");
  });
  it("tells her", () => {
    expect(withoutFamily(before(), family, uuid).feedNotices?.[0]).toMatch(/no longer in this family/i);
  });
  it("turns a draft of a family entry into something she can keep, with the words she typed", () => {
    const draft = { ...write("shared"), body: "half typed", revision: 3, space_id: family, files: [], existing: true } as EditorDraft;
    const next = withoutFamily({ ...before(), drafts: { "record:shared": draft } }, family, uuid);
    expect(next.drafts).toEqual({});
    const kept = next.outbox.find((m) => m.type === "save" && m.record.id === "shared") as Extract<Mutation, { type: "save" }>;
    expect(kept).toMatchObject({ left_space: family, error: notSentMessage, record: { body: "half typed" } });
  });
  it("takes a new draft's lost baby off it, and leaves the words", () => {
    const draft = { ...write("n", "diaper", "baby"), files: [] } as EditorDraft, other = { ...write("o", "diaper", "mine"), files: [] } as EditorDraft;
    const next = withoutFamily({ ...before(), drafts: { "new:diaper": draft, "new:other": other } }, family, uuid);
    expect(next.drafts["new:diaper"]).toMatchObject({ child_id: null, body: "words" });
    expect(next.drafts["new:other"]).toMatchObject({ child_id: "mine" });
  });
  it("sends nothing of it if she rejoins until it's back in play", () => {
    const next = rejoined(withoutFamily(before(), family, uuid), boot());
    expect(next.outbox.map((m) => m.error)).toEqual([undefined, undefined, undefined]);
    expect(next.outbox[0].left_space).toBeUndefined();
  });
  it("takes back the notice when she's in a family again", () => {
    expect(rejoined(withoutFamily(before(), family, uuid), boot()).feedNotices).toEqual([]);
  });
  it("isn't sent again by the retry that follows a space appearing", () => {
    const next = retryUnavailable(withoutFamily(before(), family, uuid));
    expect(next.outbox[0].error).toBe(notSentMessage);
  });
});

describe("Keep in my personal space", () => {
  const stopped = (over: Partial<Extract<Mutation, { type: "save" }>> = {}): Extract<Mutation, { type: "save" }> =>
    ({ id: "q", generation: 1, space_id: family, left_space: family, error: notSentMessage, type: "save", files: [], record: write("q", "custom", "baby", { label: "Note", attachment_ids: ["gone-upload"], event_id: "event" }), ...over });
  it("copies it under a new id, in the personal space, with the words she wrote", () => {
    const next = keepInPersonal(state({ outbox: [stopped()] }), stopped(), uuid);
    expect(next.outbox).toHaveLength(1);
    const kept = next.outbox[0] as Extract<Mutation, { type: "save" }>;
    expect(kept.record.id).not.toBe("q");
    expect(kept).toMatchObject({ space_id: personal, generation: 2, record: { title: "q", body: "words", child_id: null } });
    expect(kept.error).toBeUndefined();
    expect(kept.left_space).toBeUndefined();
    expect(kept.record.revision).toBeUndefined();
  });
  it("drops a retired upload's id and asks for the file again, because reusing it would be refused", () => {
    const next = keepInPersonal(state({ outbox: [stopped()] }), stopped(), uuid), kept = next.outbox[0] as Extract<Mutation, { type: "save" }>;
    expect(kept.record.data.attachment_ids).toBeUndefined();
    expect(kept.record.data.event_id).toBeUndefined();
    expect(next.feedNotices?.at(-1)).toMatch(/add its file again/i);
  });
  it("uploads a file still on this phone again, as new, and doesn't ask for it", () => {
    const file = { id: "f", uri: "file:///f", name: "f.jpg", mime_type: "image/jpeg", uploaded_id: "gone-upload" };
    const withFile = stopped({ files: [file] }), next = keepInPersonal(state({ outbox: [withFile], fileUploads: { f: "gone-upload" } }), withFile, uuid);
    const kept = next.outbox[0] as Extract<Mutation, { type: "save" }>;
    expect(kept.files[0]).toMatchObject({ uri: "file:///f" });
    expect(kept.files[0].uploaded_id).toBeUndefined();
    expect(kept.files[0].id).not.toBe("f");
    expect(next.fileUploads).toEqual({});
    expect(next.feedNotices ?? []).toEqual([]);
  });
  it("keeps the last words when she'd edited it twice", () => {
    const first = stopped(), second: Mutation = { ...stopped(), id: "r", record: { ...stopped().record, body: "second words" } };
    const next = keepInPersonal(state({ outbox: [first, second] }), first, uuid);
    expect(next.outbox).toHaveLength(1);
    expect((next.outbox[0] as Extract<Mutation, { type: "save" }>).record.body).toBe("second words");
  });
  it("keeps a baby only if that baby is still hers", () => {
    const own = stopped({ record: write("q", "diaper", "mine") });
    expect((keepInPersonal(state({ outbox: [own] }), own, uuid).outbox[0] as Extract<Mutation, { type: "save" }>).record.child_id).toBe("mine");
  });
  it("won't start a kept reminder ringing on its own", () => {
    const list = stopped({ record: write("q", "routine", null, { enabled: true }) });
    expect((keepInPersonal(state({ outbox: [list] }), list, uuid).outbox[0] as Extract<Mutation, { type: "save" }>).record.data.enabled).toBe(false);
  });
  it("has nothing to copy from a tap", () => {
    const tap: Mutation = { id: "t", generation: 1, space_id: family, left_space: family, error: notSentMessage, type: "feed_action", record_id: "x", action: { id: "t", action: "finish", at: "2026-11-05T00:00:00.000Z" } };
    const before = state({ outbox: [tap] });
    expect(keepInPersonal(before, tap, uuid)).toBe(before);
  });
});


import { describe, expect, it } from "vitest";
import { keepInPersonal, addMutation, localFileUris, noticeTitle, notSentMessage, pendingRecords, retargeted, rejoined, retryUnavailable, withoutFamily, type Moved, recoveredNotice, upgradedState, retryMutation, draftsBeforeFamily, settledDraft, queuedChain, keepHeldDraft, inheritedFiles, baseOf, waitingForEarlier, heldDraftWarning, deviceVersion, fencedState, holdEditor, sendHeldToFamily } from "./outbox";
import legacy from "./fixtures/legacy-family-39-40.json";
import { emptyState, optimisticRecord, type Bootstrap, type DeviceState, type EditorDraft, type Mutation, type RecordData } from "./models";
import { visitWriteProblem, visitLinkMessage, keepVisitInPersonal } from "./outbox";

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
  const queued: Mutation = { id: "q", generation: 1, space_id: family, type: "save", base: { after: [] }, files: [], record: write("q", "diaper", "baby") };
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
  it("tells her, and doesn't call it a tap", () => {
    const notice = withoutFamily(before(), family, uuid).feedNotices![0];
    expect(notice).toMatch(/no longer in this family/i);
    // A row shows two lines of this at normal text size, and what to do next has to fit in them.
    expect(notice.length).toBeLessThanOrEqual(68);
    expect(notice).toMatch(/Sync & recovery/);
    expect(noticeTitle(notice)).toBe("Your family");
    expect(noticeTitle("This feed was removed.")).toBe("A tap wasn’t added");
    expect(noticeTitle(recoveredNotice)).toBe("Back on this phone");
  });
  it("turns a draft of a family entry into something she can keep, with the words she typed", () => {
    const draft = { ...write("shared"), body: "half typed", revision: 3, space_id: family, files: [], existing: true } as EditorDraft;
    const next = withoutFamily({ ...before(), drafts: { "record:shared": draft } }, family, uuid);
    expect(next.drafts).toEqual({});
    expect(next.heldDrafts![0].draft).toMatchObject({ body: "half typed", space_id: family });
    expect(next.outbox.some((m) => m.type === "save" && m.record.id === "shared")).toBe(false);
  });
  it.each(["", "words I did not save"])("never sends an opened or edited draft on rejoin (%s)", (body) => {
    const draft = { ...write("shared", "event"), body, revision: 3, space_id: family, files: [], existing: true } as EditorDraft;
    const left = withoutFamily({ ...before(), drafts: { "record:shared": draft } }, family, uuid);
    const back = retryUnavailable(rejoined(upgradedState(left), boot()));
    expect(back.heldDrafts![0].draft.body).toBe(body);
    expect(back.outbox.some((m) => m.type === "save" && m.record.id === "shared")).toBe(false);
    expect(draftsBeforeFamily(back, boot()).heldDrafts).toEqual(back.heldDrafts);
    expect(settledDraft(draft, back).body).toBe(body);
  });
  it("keeps a saved change separate from the editor draft it preceded", () => {
    const saved = { ...queued, record: write("shared", "event") } as Mutation;
    const draft = { ...write("shared", "event"), body: "unsaved", space_id: family, files: [], existing: true } as EditorDraft;
    const left = withoutFamily({ ...before(), outbox: [saved], drafts: { d: draft } }, family, uuid);
    expect(queuedChain(left.outbox, left.outbox[0])).toHaveLength(1);
    const back = rejoined(left, boot());
    expect(back.outbox[0]).toMatchObject({ id: saved.id, error: undefined, left_space: undefined });
    expect(back.outbox).toHaveLength(1);
    expect(back.heldDrafts![0].draft.body).toBe("unsaved");
    expect(rejoined(back, boot()).outbox).toEqual(back.outbox);
    const kept = keepInPersonal(left, left.outbox[0], uuid).outbox;
    expect(kept.at(-1)).toMatchObject({ record: { body: "words" } });
    expect(kept).toHaveLength(1);
    expect(left.heldDrafts![0].draft.body).toBe("unsaved");
  });
  it("holds ambiguous saves stopped by the old build for an explicit personal save", () => {
    const old = state({ version: 2, outbox: [{ ...queued, base: undefined, left_space: family, error: notSentMessage }] });
    const next = rejoined(upgradedState(old), boot());
    expect(next.outbox).toEqual([]);
    expect(next.heldDrafts![0].draft.body).toBe("words");
    const kept = keepHeldDraft(next, next.heldDrafts![0].id, uuid);
    expect(kept.outbox[0].space_id).toBe(personal);
    expect(kept.outbox[0].error).toBeUndefined();
    expect(kept.heldDrafts).toEqual([]);
    expect(upgradedState(upgradedState(old))).toEqual(upgradedState(old));
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


it("holds an old private visit question instead of following its family baby into sharing", () => {
  const question = { ...edit("q"), record: write("q", "question", "baby", { event_id: "visit" }) } as Mutation;
  const held = state({ outbox: [question] });
  expect(visitWriteProblem(held, question)).toBe(true);
  const next = retargeted(held, question, moved({ record: { id: "baby", name: "Baby" } as never }), uuid);
  expect(next.outbox[0]).toMatchObject({ space_id: personal, error: visitLinkMessage });
  const kept = keepVisitInPersonal(next, next.outbox[0], uuid);
  expect(kept.outbox).toHaveLength(1);
  expect(kept.outbox[0]).toMatchObject({ space_id: personal, record: { kind: "journal", body: "words", child_id: "baby" } });
  expect((kept.outbox[0] as any).record.data.event_id).toBeUndefined();
  expect((kept.outbox[0] as any).record.id).not.toBe("q");
});
it("holds a linked journal when its visit moved to another space", () => {
  const note = { ...edit("note"), record: write("note", "journal", null, { event_id: "visit" }) } as Mutation;
  expect(visitWriteProblem(state({ records: [row("visit", 2, family)], outbox: [note] }), note)).toBe(true);
});

it("Save privately on either stopped row makes one latest journal, and a repeated stale press makes none", () => {
  const first = { ...edit("q", 1), record: write("q", "question", "baby", { event_id: "visit" }) } as Mutation, second = { ...first, id: "second", record: { ...(first as any).record, body: "latest words" } } as Mutation;
  const source = state({ outbox: [first, second] });
  const kept = keepVisitInPersonal(source, second, uuid);
  expect(kept.outbox).toHaveLength(1); expect((kept.outbox[0] as any).record.body).toBe("latest words");
  expect(keepVisitInPersonal(kept, first, uuid)).toBe(kept);
});
it("never follows a moved-baby answer into sharing an unlinked personal journal", () => {
  const note = { ...edit("private", 1), record: write("private", "journal", "baby") } as Mutation;
  const next = retargeted(state({ outbox: [note] }), note, moved({ record: { id: "baby", name: "Baby" } as never }), uuid);
  expect(next.outbox[0].space_id).toBe(personal); expect(next.outbox[0].error).toMatch(/baby is no longer available/);
  const kept = keepVisitInPersonal(next, next.outbox[0], uuid);
  expect(kept.outbox).toHaveLength(1);
  expect(kept.outbox[0]).toMatchObject({ space_id: personal, record: { kind: "journal", child_id: null, body: "words" } });
});

it("private visit recovery retains earlier local files still named by the latest save", () => {
  const file = { id: "photo", uri: "file:///still-readable.jpg", uploaded_id: "attachment" },
    first = { ...edit("q"), files: [file], record: write("q", "journal", null, { event_id: "visit", attachment_ids: ["attachment"] }) } as Mutation,
    linked = { ...first, id: "linked", files: [] } as Mutation,
    kept = keepVisitInPersonal(state({ outbox: [first, linked] }), linked, uuid);
  expect((kept.outbox[0] as any).files).toHaveLength(1);
  expect((kept.outbox[0] as any).files[0]).toMatchObject({ uri: file.uri });
  expect((kept.outbox[0] as any).files[0].uploaded_id).toBeUndefined();
});

describe("unfinished work stays outside the queue", () => {
  const draft = (body: string): EditorDraft => ({ ...write("entry", "feeding", "baby"), body, space_id: family, files: [{ id: "photo", uri: "file:///photo", name: "private.jpg", mime_type: "image/jpeg" }], existing: true });
  it("never inherits an unsaved file or an ancestor from recovery when the saved editor reopens", () => {
    const left = withoutFamily(state({ drafts: { d: draft("unsaved") } }), family, uuid), back = rejoined(left, boot());
    expect(inheritedFiles(back, "entry")).toEqual([]);
    expect(baseOf(back, "entry")).toEqual({ after: [] });
    const save = edit("entry", 1);
    expect(waitingForEarlier([...back.outbox, save], save)).toBe(false);
    expect(back.heldDrafts![0].draft.files[0].name).toBe("private.jpg");
  });
  it("keeps exactly one of two shown drafts, retaining the other's different words and files", () => {
    const left = withoutFamily(state({ drafts: { a: draft("long unsaved words"), b: draft("original words") } }), family, uuid);
    const first = keepHeldDraft(left, left.heldDrafts![0].id, uuid);
    expect((first.outbox[0] as any).record.body).toBe("long unsaved words");
    expect(first.heldDrafts![0].draft.body).toBe("original words");
    expect(keepHeldDraft(first, left.heldDrafts![0].id, uuid)).toBe(first);
    expect(heldDraftWarning(2)).toContain("2 later saved changes");
  });
  it.each(["event", "feeding", "question", "journal"] as const)("keeps a held %s personal after rejoin without a baby link that could move it back", (kind) => {
    const left = withoutFamily(state({ drafts: { d: { ...draft("only my words"), kind } } }), family, uuid),
      back = { ...rejoined(left, boot()), bootstrap: boot() },
      kept = keepHeldDraft(back, back.heldDrafts![0].id, uuid);
    expect(kept.outbox).toHaveLength(1);
    expect(kept.outbox[0]).toMatchObject({ space_id: personal, generation: 2, record: { kind, child_id: null, body: "only my words" } });
  });
  it.each([undefined, "a-former-family"])("never gives a personal non-journal copy a family baby, even with origin %s", (left_space) => {
    const change: Mutation = { id: "stopped", generation: 1, type: "save", space_id: family, left_space, files: [], record: write("entry", "event", "baby") };
    expect(keepInPersonal(state({ outbox: [change] }), change, uuid).outbox[0]).toMatchObject({ space_id: personal, record: { child_id: null } });
    const mine = { ...change, record: { ...change.record, child_id: "mine" } };
    expect(keepInPersonal(state({ outbox: [mine] }), mine, uuid).outbox[0]).toMatchObject({ space_id: personal, record: { child_id: "mine" } });
  });
  it.each(["event", "journal"] as const)("keeps only a personal baby on a held %s copy even if an older origin is missing", (kind) => {
    const held = { id: "held", draft: { ...draft("my words"), kind, space_id: undefined } };
    expect(keepHeldDraft(state({ heldDrafts: [held] }), held.id, uuid).outbox[0]).toMatchObject({ space_id: personal, record: { child_id: null } });
    expect(keepHeldDraft(state({ heldDrafts: [{ ...held, draft: { ...held.draft, child_id: "mine" } }] }), held.id, uuid).outbox[0]).toMatchObject({ record: { child_id: "mine" } });
  });
  it("retains the origin of an older stopped save when only left_space recorded its family", () => {
    const stopped: Mutation = { id: "old-save", generation: 1, type: "save", files: [], space_id: undefined, left_space: family, record: write("entry", "event", "baby") },
      upgraded = upgradedState(state({ version: 3, outbox: [stopped] }));
    expect(upgraded.heldDrafts![0].draft.space_id).toBe(family);
    expect(keepHeldDraft(upgraded, stopped.id, uuid).outbox[0]).toMatchObject({ space_id: personal, record: { child_id: null } });
  });
  it("migrates uncertain stopped ancestors with every follow-up, but releases a provably saved base", () => {
    const saved = { ...edit("saved", 2), base: { after: [] }, left_space: family, space_id: family, draft_only: true },
      uncertain = { ...edit("entry", 1), left_space: family, space_id: family },
      tap: Mutation = { id: "tap", generation: 1, space_id: family, type: "feed_action", record_id: "entry", action: { id: "tap", action: "finish", at: "2026-11-06T00:00:00Z" } };
    const next = rejoined(upgradedState(state({ version: 3, outbox: [uncertain, tap, saved] })), boot());
    expect(next.outbox.map((m) => m.id)).toEqual([saved.id]);
    expect(next.outbox[0]).toMatchObject({ left_space: undefined, error: undefined });
    expect(next.heldDrafts![0].followups).toEqual([tap]);
  });
  it("retains Keep on this phone on rejoin, clears its stale family error, and allows deliberate Retry", () => {
    const row = { ...edit("entry", 1), space_id: family, left_space: family, localOnly: true, error: notSentMessage };
    const next = rejoined(state({ outbox: [row] }), boot()).outbox[0];
    expect(next.localOnly).toBe(true); expect(next.left_space).toBeUndefined(); expect(next.error).toBeUndefined();
    expect(retryMutation(next).localOnly).toBe(false);
  });
  it("uses the family generation for an editor and retires it when that family generation changes", () => {
    const old = state({ version: 3, drafts: { d: draft("words") } });
    old.bootstrap!.spaces!.find((space) => space.id === family)!.generation = 7;
    const next = withoutFamily(old, family, uuid);
    expect(next.version).toBe(deviceVersion); expect(emptyState().version).toBe(deviceVersion);
    expect(next.heldDrafts![0].draft.generation).toBe(7);
    expect(fencedState(next, { generation: 3, spaces: boot().spaces!.map((space) => ({ ...space, generation: space.generation + 1 })) }).heldDrafts).toEqual([]);
  });
});

it("detaches an unreadable family baby from a queued personal journal without changing its words or intent", () => {
  const note = { ...edit("note", 1), record: write("note", "journal", "baby") } as Mutation;
  const next = withoutFamily(state({ outbox: [note] }), family, uuid);
  expect(next.outbox[0]).toMatchObject({ space_id: personal, record: { child_id: null, body: "words" } });
});


describe("legacy editor provenance and dependency boundaries", () => {
  const photo = { id: "private-file", uri: "file:///private", name: "private.jpg", mime_type: "image/jpeg" };
  const uncertain = (): Extract<Mutation, { type: "save" }> => ({ id: "legacy", generation: 1, type: "save", space_id: family, files: [photo], record: write("entry", "feeding", "baby") });
  const action = (id: string, space_id = family): Mutation => ({ id, generation: 1, type: "feed_action", space_id, record_id: "entry", action: { id, action: "finish", at: "2026-11-05T01:00:00Z" } });
  it.each([2, 3, 4])("holds an old rejoined draft and its based edits even after departure flags were erased (version %s)", (version) => {
    const first = { ...uncertain(), localOnly: false }, later = { ...uncertain(), id: "later", base: { after: [first.id] }, record: { ...first.record, body: "based on unfinished words" } };
    const next = upgradedState(state({ version, outbox: [first, later, action("finish")] }));
    expect(next.outbox).toEqual([]); expect(next.heldDrafts![0].draft.files).toEqual([photo]);
    expect(next.heldDrafts![0].followups?.map((m) => m.id)).toEqual(["later", "finish"]);
    expect(rejoined(withoutFamily(next, family, uuid), boot()).outbox).toEqual([]);
  });
  it("does not take an independent saved edit, another space, or a child operation with the held draft", () => {
    const first = { ...uncertain(), localOnly: false }, otherSpace = { ...uncertain(), id: "personal", space_id: personal, base: { after: [first.id] } },
      independent = { ...uncertain(), id: "saved", base: { after: [] }, record: { ...first.record, body: "really saved" } },
      child: Mutation = { id: "child", type: "child_birth", child_id: "entry", space_id: family, generation: 1, birth_date: "2026-11-01", previous: null };
    const next = upgradedState(state({ version: 3, outbox: [first, otherSpace, child, action("own-action", personal), independent, action("after-saved")] }));
    expect(next.outbox.map((m) => m.id)).toEqual(["personal", "child", "own-action", "saved", "after-saved"]);
    expect(next.heldDrafts![0].followups ?? []).toEqual([]);
    expect(keepHeldDraft(next, first.id, uuid).outbox.map((m) => m.id)).toEqual(expect.arrayContaining(next.outbox.map((m) => m.id)));
  });
  it("records Save intent for a new queued row, so leaving and rejoining delivers the same write", () => {
    const made = { ...uncertain(), id: "actually-saved", record: { ...uncertain().record, id: "new-entry" } }, queued = addMutation(state(), made);
    expect(queued.outbox[0]).toMatchObject({ base: { after: [] } });
    const next = rejoined(withoutFamily(queued, family, uuid), boot());
    expect(next.outbox).toHaveLength(1); expect(next.outbox[0]).toMatchObject({ id: made.id, error: undefined, left_space: undefined });
    expect(next.heldDrafts ?? []).toEqual([]);
  });
  it("keeps only current-family held drafts and files when the personal generation changes", () => {
    const draft: EditorDraft = { ...write("entry"), files: [photo], space_id: family }, held = { id: "held", draft },
      old = state({ heldDrafts: [held], fileUploads: { [photo.id]: "uploaded" } });
    old.bootstrap = { ...boot(), spaces: boot().spaces!.filter((space) => space.id === personal), children: [] };
    const next = fencedState(old, { generation: 3, spaces: [{ ...old.bootstrap.spaces![0], generation: 3 }] });
    expect(next.heldDrafts).toEqual([]); expect(next.fileUploads).toEqual({});
    expect(localFileUris(next).has(photo.uri)).toBe(false);
    const active = fencedState(state({ heldDrafts: [held], fileUploads: { [photo.id]: "uploaded" } }), { generation: 3, spaces: boot().spaces!.map((space) => space.id === personal ? { ...space, generation: 3 } : space) });
    expect(active.heldDrafts).toEqual([held]); expect(active.fileUploads).toEqual(old.fileUploads);
    expect(localFileUris(active).has(photo.uri)).toBe(true);
  });
});


describe("shipped build39/40 queue migration", () => {
  it("preserves fresh one-tap, Today, editor and share saves from executed old addMutation output", () => {
    const next = upgradedState(state({ version: 2, outbox: legacy.fresh as Mutation[] }));
    expect(next.outbox.map((m) => m.id)).toEqual(legacy.fresh.map((m) => m.id));
    expect(next.heldDrafts ?? []).toEqual([]);
    expect(rejoined(withoutFamily(next, family, uuid), boot()).outbox.map((m) => m.id)).toEqual(next.outbox.map((m) => m.id));
  });
  it("holds real old-rejoin output, including an import, with an upgrade notice", () => {
    const next = upgradedState(state({ version: 2, outbox: legacy.rejoined as Mutation[] }));
    expect(next.outbox).toEqual([]);
    expect(next.heldDrafts?.find((h) => h.id === "save-shared-source")?.followups?.map((m) => m.id)).toEqual(["import"]);
    expect(next.feedNotices?.join()).toMatch(/Sync & recovery/);
    expect(next.heldDrafts?.find((h) => h.id === "save-feed")).toMatchObject({ uncertain: true });
  });
  it("does not hold a personal save when the space flag supplies no personal id", () => {
    const old = state({ outbox: [{ ...edit("own"), localOnly: false }] });
    old.bootstrap = { ...boot(), personal_space_id: undefined, spaces: undefined };
    expect(upgradedState(old).heldDrafts ?? []).toEqual([]);
  });
  it("replaces late editor autosaves in one slot but preserves the departure snapshot", () => {
    let next = withoutFamily(state({ drafts: { d: { ...write("entry"), space_id: family, files: [] } } }), family, uuid);
    const departure = next.heldDrafts![0];
    for (let at = 0; at < 25; at++) next = holdEditor(next, "d", { ...departure.draft, body: `latest ${at}` }, uuid);
    expect(next.heldDrafts).toHaveLength(2);
    expect(next.heldDrafts![0]).toEqual(departure);
    expect(next.heldDrafts![1].draft.body).toBe("latest 24");
  });
  it("can keep the shown latest based Save instead of the earlier unfinished words", () => {
    const first = { ...edit("entry"), space_id: family, localOnly: false }, later = { ...first, id: "real-save", base: { after: [first.id] }, record: { ...(first as any).record, body: "the real saved words" } };
    const next = upgradedState(state({ outbox: [first, later] }));
    expect(keepHeldDraft(next, first.id, uuid, true).outbox[0]).toMatchObject({ record: { body: "the real saved words" } });
  });
});

it("explicitly sends ambiguous shipped work once with its dependent import and saved delivery ids", () => {
  const held = upgradedState(state({ outbox: legacy.rejoined as Mutation[] }));
  const sent = sendHeldToFamily(held, "save-shared-source");
  expect(sent.outbox.map((m) => m.id)).toEqual(["save-shared-source", "import"]);
  expect(sendHeldToFamily(sent, "save-shared-source")).toBe(sent);
  expect(upgradedState(sent).outbox.map((m) => m.id)).toEqual(["save-shared-source", "import"]);
  const former = { ...held, bootstrap: { ...boot(), spaces: boot().spaces!.filter((space) => space.id === personal) } };
  expect(sendHeldToFamily(former, "save-shared-source")).toBe(former);
});
it("deduplicates an identical departure snapshot only after an explicit late Save", () => {
  const draft = { ...write("entry"), space_id: family, files: [] }, left = withoutFamily(state({ drafts: { d: draft } }), family, uuid);
  const saved = addMutation(left, { id: "late-save", type: "save", space_id: family, generation: 1, record: write("entry"), files: [] });
  expect(saved.heldDrafts).toEqual([]);expect(saved.outbox.map((m) => m.id)).toEqual(["late-save"]);
  expect(addMutation(left, { id: "different-save", type: "save", space_id: family, generation: 1, record: { ...write("entry"), body: "different" }, files: [] }).heldDrafts).toHaveLength(1);
});

it("does not duplicate a held row re-added by older-build recovery, or its import", () => {
  const held = upgradedState(state({ outbox: legacy.rejoined as Mutation[] }));
  const recovered = { ...held, outbox: legacy.rejoined as Mutation[] };
  const next = upgradedState(recovered);
  expect(next.heldDrafts).toEqual(held.heldDrafts);
  expect(next.outbox).toEqual([]);
});
it("normalizes fresh old Saves before later edits establish their dependency baseline", () => {
  const next = upgradedState(state({ outbox: legacy.fresh as Mutation[] }));
  expect(next.outbox.filter((m) => m.type === "save").every((m) => !!m.base)).toBe(true);
  expect(withoutFamily(state({ outbox: [{ ...edit("old"), space_id: family, left_space: family, generation: 1 }] }), family, uuid).outbox).toEqual([]);
});
it.each(["unfinished", "wrong generation", "personal", "caregiver question"])("refuses Send to family for %s", (reason) => {
  const held = upgradedState(state({ outbox: legacy.rejoined as Mutation[] }));
  const one = held.heldDrafts![0];
  if (reason === "unfinished") one.uncertain = false;
  if (reason === "wrong generation") one.draft.generation = 999;
  if (reason === "personal") one.draft.space_id = personal;
  if (reason === "caregiver question") { held.bootstrap!.spaces!.find((s) => s.id === family)!.role = "caregiver"; one.draft.kind = "question"; }
  expect(sendHeldToFamily(held, one.id)).toBe(held);
});
it("lets a caregiver explicitly send a retried old care log with its original baby and delivery id", () => {
  const old = state({ outbox: [{ ...edit("care"), space_id: family, generation: 1, localOnly: false, record: write("care", "diaper", "baby") } as Mutation] });
  old.bootstrap!.spaces!.find((s) => s.id === family)!.role = "caregiver";
  const held = upgradedState(old), sent = sendHeldToFamily(held, "m-care");
  expect(sent.outbox).toHaveLength(1); expect(sent.outbox[0]).toMatchObject({ id: "m-care", space_id: family, record: { child_id: "baby", kind: "diaper" } });
});

it("omits an absent optional held section at each mutation and generation fence", () => {
  const none = state();
  expect(Object.hasOwn(addMutation(none, edit("new")), "heldDrafts")).toBe(false);
  expect(Object.hasOwn(fencedState(none, { generation: 3, spaces: boot().spaces }), "heldDrafts")).toBe(false);
  expect(Object.hasOwn(fencedState(none, { generation: 2, spaces: boot().spaces!.map((s) => ({ ...s, generation: 9 })) }), "heldDrafts")).toBe(false);
});

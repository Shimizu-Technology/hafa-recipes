import { describe, it, expect } from "vitest";
import type { BabyRecord, DeviceState } from "./models";
import { withFeedAction } from "./feed-reducer";
import {
  rejectedAction,
  retryLater,
  addMutation,
  mutationRecordId,
  uploadedReferences,
  heldUntil,
  fencedState,
  pendingRecords,
  searchLocal,
  shouldRetry,
  waitingForEarlier,
  waitingForImport,
  retryMutation,
  inheritedFiles,
  advancePending,
  advanceAfterImport,
  birthStep,
  queueRemovedUploads,
  withPendingBirths,
  withSettled,
  withoutChain,
  queuedChain,
  laterChangesNotice,
  feedEdit,
  baseOf,
  settledDraft,
} from "./outbox";
import { emptyState, optimisticRecord, type Mutation } from "./models";
const row = optimisticRecord({
  id: "one",
  kind: "source",
  title: "Video",
  body: "Notes",
  child_id: null,
  occurred_at: "2026-10-20T00:00:00Z",
  data: { source_text: "A hidden tip about hospital bag packing", topics: ["Birth"] },
});
describe("offline care and source recovery", () => {
  it("keeps a single mutation for a repeated durable submission", () => {
    const m: Mutation = { id: "retry", generation: 1, type: "save", record: row, files: [] };
    const first = addMutation(emptyState(), m);
    expect(addMutation(first, m).outbox).toHaveLength(1);
  });
  it("shows queued records and corrections before the connection returns", () => {
    const m: Mutation = {
      id: "correction",
      generation: 1,
      type: "save",
      record: { ...row, body: "Corrected note" },
      files: [],
    };
    expect(pendingRecords({ ...emptyState(), records: [row], outbox: [m] })[0].body).toBe("Corrected note");
  });
  it("removes queued deletes from visible history", () =>
    expect(
      pendingRecords({
        ...emptyState(),
        records: [row],
        outbox: [{ id: "delete", generation: 1, type: "delete", record: row }],
      })
    ).toEqual([]));
  it("retires all stale offline records, drafts, imports and selected child after deletion generation changes", () => {
    const state = {
      ...emptyState(),
      records: [row],
      selectedChild: "child",
      bootstrap: {
        generation: 2,
        children: [],
        ai_available: false,
        profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false },
      },
    };
    expect(fencedState(state, 3)).toMatchObject({
      records: [],
      drafts: {},
      outbox: [],
      imports: [],
      selectedChild: null,
    });
  });
  it("finds information inside an old transcript and topics", () => {
    expect(searchLocal(row, "hidden hospital")).toBe(true);
    expect(searchLocal(row, "birth")).toBe(true);
    expect(searchLocal(row, "missing")).toBe(false);
  });
  it("allows transient startup failures to recover the cached account", () => {
    expect([0, 408, 429, 503].every(shouldRetry)).toBe(true);
    expect([401, 403, 409, 410, 422].some(shouldRetry)).toBe(false);
  });
});

describe("offline attachment ancestry", () => {
  it("persists discarded upload cleanup without retiring another local revision's file", () => {
    const file = { id: "photo", uri: "file:///private/photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" };
    const mutation: Mutation = { id: "save", generation: 1, type: "save", record: row, files: [file] };
    const before = { ...emptyState(), fileUploads: { photo: "uploaded" }, outbox: [mutation] };
    expect(queueRemovedUploads(before, { ...before, outbox: [] }).fileReleases).toEqual(["uploaded"]);
    const shared = { ...mutation, id: "another-revision" };
    expect(
      queueRemovedUploads({ ...before, outbox: [mutation, shared] }, { ...before, outbox: [shared] }).fileReleases
    ).toEqual([]);
    expect(
      fencedState({ ...before, fileReleases: ["uploaded"], bootstrap: { generation: 1 } as never }, 2).fileReleases
    ).toEqual([]);
  });
  it("inherits pending photo files when reopening an unsynced journal and retains the completed upload ID", () => {
    const file = { id: "local-photo", uri: "file:///private/photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" };
    const state = {
      ...emptyState(),
      outbox: [
        {
          id: "save-a",
          type: "save" as const,
          generation: 1,
          record: { ...row, kind: "journal" as const },
          files: [file],
        },
      ],
      fileUploads: { "local-photo": "server-attachment" },
    };
    expect(inheritedFiles(state, row.id)).toEqual([{ ...file, uploaded_id: "server-attachment" }]);
  });
  it("advances a queued correction and deletion to the successfully saved ancestor revision without losing files", () => {
    const saved = { ...row, revision: row.revision + 1, data: { attachment_ids: ["server-attachment"] } },
      file = { id: "local-photo", uri: "file:///private/photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" };
    const correction: Mutation = {
      id: "save-b",
      type: "save",
      generation: 1,
      record: { ...row, body: "edited while offline" },
      files: [file],
    };
    const landed: Mutation = { id: "save-a", type: "save", generation: 1, record: row, files: [] };
    expect(advancePending(correction, landed, saved)).toMatchObject({
      record: { revision: row.revision + 1, body: "edited while offline" },
      files: [file],
    });
    expect(advancePending({ id: "delete", type: "delete", generation: 1, record: row }, landed, saved)).toMatchObject({
      record: { revision: row.revision + 1 },
    });
  });
});


import { createStockShareScope } from "./stock-share-scope";
it("quarantines ownerless stock shares and fences account and generation changes", () => {
  const scope = createStockShareScope(), anonymous = {}, signedIn = {};
  scope.observe(anonymous, null);
  scope.observe(anonymous, "issuer:account-A");
  expect(scope.allow(anonymous, "stable-A", 1)).toBe(false);
  scope.observe(signedIn, "issuer:account-A");
  expect(scope.allow(signedIn, "stable-A", 1)).toBe(true);
  expect(scope.allow(signedIn, "stable-A", 2)).toBe(false);
  scope.observe(signedIn, "issuer:account-B");
  expect(scope.allow(signedIn, "stable-B", 1)).toBe(false);
});

it("holds later saves, imports and deletes behind any unresolved operation on the same record", () => {
  const failed: Mutation = { id: "failed", type: "save", generation: 1, record: row, files: [], error: "Upload failed" };
  const edit: Mutation = { ...failed, id: "edit", error: undefined };
  const imported: Mutation = { id: "import", type: "import", generation: 1, record_id: row.id, files: [] };
  const deleted: Mutation = { id: "delete", type: "delete", generation: 1, record: row };
  const unrelated: Mutation = { ...edit, id: "other", record: { ...row, id: "different" } };
  const queue = [failed, edit, imported, deleted, unrelated];
  expect(queue.map(m => waitingForEarlier(queue, m))).toEqual([false, true, true, true, false]);
  expect(waitingForEarlier([imported, edit], edit)).toBe(true);
});
it("retains failed and phone-only originals through relaunch, including files and latest visible edits", () => {
  const failed: Mutation = { id: "failed", type: "save", generation: 1, record: row,
    files: [{ id: "photo", uri: "file:///photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" }],
    error: "Upload failed", localOnly: true };
  const edit: Mutation = { ...failed, id: "edit", record: { ...row, body: "Later edit" }, localOnly: undefined, error: undefined };
  const restored = JSON.parse(JSON.stringify({ ...emptyState(), outbox: [failed, edit] }));
  expect(restored.outbox[0]).toEqual(failed);
  expect(waitingForEarlier(restored.outbox, restored.outbox[1])).toBe(true);
  expect(pendingRecords(restored)[0].body).toBe("Later edit");
  expect(retryMutation(failed)).toMatchObject({ localOnly: false, error: undefined, conflict: false, files: failed.files });
});

it("holds saves for active imports but lets deletion cancel the import", () => {
  const save: Mutation = { id: "save", type: "save", generation: 1, record: row, files: [] };
  const jobs = [{ id: "job", record_id: row.id, status: "processing" }];
  expect(waitingForImport(jobs, save)).toBe(true);
  expect(waitingForImport(jobs, { ...save, record: { ...row, id: "other" } })).toBe(false);
  expect(waitingForImport(jobs, { id: "delete", type: "delete", generation: 1, record: row })).toBe(false);
  expect(waitingForImport([{ ...jobs[0], status: "ready" }], save)).toBe(true);
  expect(waitingForImport([{ ...jobs[0], status: "ready", reconciled: true }], save)).toBe(false);
  // A deferred native receipt saved only an original; no worker owns the record.
  expect(waitingForImport([{ ...jobs[0], status: "deferred" }], save)).toBe(false);
});

it("keeps import metadata while applying the later user's editable source fields", () => {
  const edit: Mutation = { id: "edit", type: "save", generation: 1, files: [],
    record: { ...row, body: "My note", title: "My title", data: { source_text: "My original", topics: ["My topic"], status: "queued" } } };
  const terminal = { ...row, revision: row.revision + 2, data: { summary: "Organized", status: "ready", creator: "Example creator", source_text: "Acquired text" } };
  const job = { id: "job", status: "ready", baseline: row };
  expect(advanceAfterImport(edit, terminal, job)).toMatchObject({ record: { revision: terminal.revision, title: "My title", body: "My note",
    data: { source_text: "My original", topics: ["My topic"], summary: "Organized", status: "ready", creator: "Example creator" } } });
  expect(advanceAfterImport({ ...edit, record: { ...edit.record, title: "Saved source" } }, terminal,
    { ...job, baseline: { ...row, title: "Saved source" } }))
    .toMatchObject({ record: { title: terminal.title } });
  expect(advanceAfterImport({ ...edit, record: { ...edit.record, data: row.data } }, terminal, job))
    .toMatchObject({ record: { data: { source_text: "Acquired text" } } });
  expect(advanceAfterImport(edit, terminal)).toMatchObject({ conflict: true, record: { revision: row.revision } });
});

it("applies the edit's attachment additions and removals to the terminal import list", () => {
  const baseline = { ...row, data: { attachment_ids: ["keep", "remove"] } };
  const edit: Mutation = { id: "edit", type: "save", generation: 1, files: [],
    record: { ...baseline, data: { attachment_ids: ["keep", "local-addition"] } } };
  const result = { ...baseline, revision: baseline.revision + 2,
    data: { attachment_ids: ["keep", "remove", "import-addition"] } };
  expect(advanceAfterImport(edit, result, { id: "job", status: "ready", baseline }))
    .toMatchObject({ record: { data: { attachment_ids: ["keep", "import-addition", "local-addition"] } } });
});

describe("a change waiting behind its record", () => {
  const start = { id: "s", action: "start" as const, at: "2026-11-04T12:00:00.000Z", side: "left" as const },
    end = { id: "e", action: "finish" as const, at: "2026-11-04T12:01:01.500Z" },
    feedRow = (revision: number, data: BabyRecord["data"] = { method: "breast", side: "left", state: "running", actions: [start] }): BabyRecord =>
      ({ id: "feed", kind: "feeding", title: "Feeding", body: "", child_id: "baby", occurred_at: start.at, data, revision, created_at: "", updated_at: "" }),
    accepted = (revision: number, made = revision) => feedRow(revision, { method: "breast", side: "left", state: "finished", actions: [start, { ...end, revision: made }], end_at: end.at, duration_minutes: 1.02 }),
    edit = (revision: number, data: BabyRecord["data"]): Mutation => ({ id: "edit", generation: 1, type: "save", files: [], record: { ...feedRow(revision), body: "note", data } }),
    tap: Mutation = { id: "e", generation: 1, type: "feed_action", record_id: "feed", action: end },
    saved = (revision?: number): Mutation => ({ id: "s", generation: 1, type: "save", files: [], record: { ...feedRow(revision ?? 0), revision } }),
    gone = (revision: number): Mutation => ({ id: "d", generation: 1, type: "delete", record: feedRow(revision) });
  it("follows one step, this phone's own write", () => {
    expect(advancePending(edit(1, { method: "breast" }), saved(1), feedRow(2))).toMatchObject({ record: { revision: 2 } });
    expect(advancePending(gone(1), saved(1), feedRow(2))).toMatchObject({ record: { revision: 2 } });
    expect(advancePending(edit(0, { method: "breast" }), saved(), feedRow(1))).toMatchObject({ record: { revision: 1 } });
  });
  it("stays put past another phone's edit, so the API raises the conflict: nothing overwritten, nothing deleted", () => {
    expect(advancePending(edit(1, { method: "breast" }), tap, accepted(3))).toMatchObject({ record: { revision: 1, data: { method: "breast" } } });
    expect(advancePending(gone(1), tap, accepted(3))).toMatchObject({ record: { revision: 1 } });
  });
  it("stays put on a replay it has already seen", () => {
    expect(advancePending(edit(2, { method: "breast" }), tap, accepted(2))).toMatchObject({ record: { revision: 2 } });
  });
  it("never moves an edit past another phone's write when a lost tap is replayed", () => {
    // The tap made 5 and its answer was lost. Polling saw 5, so the edit says 5. Another phone wrote 6. The replay answers 6.
    expect(advancePending(edit(5, { method: "breast" }), tap, accepted(6, 5))).toMatchObject({ record: { revision: 5 } });
    expect(advancePending(gone(5), tap, accepted(6, 5))).toMatchObject({ record: { revision: 5 } });
    // Built before the tap: it follows to 5 and no further, and takes nothing from the write it never saw. The API refuses it.
    const behind = advancePending(edit(4, withFeedAction(feedRow(1).data, end)), tap, { ...accepted(6, 5), data: { ...accepted(6, 5).data, duration_minutes: 9 } });
    expect(behind).toMatchObject({ record: { revision: 5, data: { duration_minutes: 1.02 } } });
  });
  it("treats a replayed create the same way: it made revision 1, wherever the row is now", () => {
    expect(advancePending(edit(1, { method: "breast" }), saved(), feedRow(2))).toMatchObject({ record: { revision: 1 } });
    expect(advancePending(edit(0, { method: "breast" }), saved(), feedRow(2))).toMatchObject({ record: { revision: 1 } });
  });
  it("doesn't guess when the API gives no proof", () => {
    const unproven = feedRow(5, { method: "breast", state: "finished", actions: [start, end] });
    expect(advancePending(edit(4, { method: "breast" }), tap, unproven)).toMatchObject({ record: { revision: 4 } });
  });
  it("follows a session's tap by the same proof", () => {
    const beat = { id: "t", action: "tap" as const, at: end.at },
      done: Mutation = { id: "t", generation: 1, type: "session_action", record_id: "feed", action: beat },
      row = (revision: number, made: number) => feedRow(revision, { session_actions: [{ ...beat, revision: made }] });
    expect(advancePending(edit(1, {}), done, row(2, 2))).toMatchObject({ record: { revision: 2 } });
    expect(advancePending(edit(2, {}), done, row(3, 2))).toMatchObject({ record: { revision: 2 } });
  });
  it("takes the API's duration when an editor opened with Done queued left it alone, so it isn't read as a correction", () => {
    const opened = withFeedAction(feedRow(1).data, end);
    expect(opened.duration_minutes).toBe(1.02);
    const stale = { ...opened, duration_minutes: 1.03 };
    // The editor captured what the phone worked out. The API's answer replaces it, and the actions come too.
    const rebased = advancePending(edit(1, opened), tap, accepted(2));
    expect(rebased).toMatchObject({ record: { revision: 2, body: "note", data: { duration_minutes: 1.02, side: "left", state: "finished", end_at: end.at, actions: [start, end] } } });
    // A value the actions don't explain was typed by a person, and stays.
    expect(advancePending(edit(1, stale), tap, accepted(2))).toMatchObject({ record: { data: { duration_minutes: 1.03 } } });
  });
  it("takes the finish when an editor opened before Done, so its empty duration isn't read as a correction", () => {
    expect(advancePending(edit(1, feedRow(1).data), tap, accepted(2))).toMatchObject({ record: { revision: 2, data: { duration_minutes: 1.02, state: "finished", end_at: end.at, actions: [start, end] } } });
  });
  it("keeps a side or duration she corrected by hand", () => {
    const corrected = { ...withFeedAction(feedRow(1).data, end), side: "right" as const };
    expect(advancePending(edit(1, corrected), tap, accepted(2))).toMatchObject({ record: { revision: 2, data: { side: "right" } } });
  });
  it("leaves records without actions alone, and ordinary saves don't rebase", () => {
    const opened = withFeedAction(feedRow(1).data, end);
    expect((advancePending(edit(1, opened), saved(1), { ...accepted(2), data: { ...accepted(2).data, duration_minutes: 9 } }) as any).record.data.duration_minutes).toBe(1.02);
  });
});

describe("a birth date waiting on this phone", () => {
  const bootstrap = { generation: 1, active: true, ai_available: false, children: [{ id: "baby", name: "Mia", revision: 3, due_date: "2026-12-10", birth_date: null }],
      profile: { display_name: "", timezone: "UTC", ai_consent: false } },
    born: Mutation = { id: "b", generation: 1, type: "child_birth", child_id: "baby", birth_date: "2026-11-05", previous: null };
  it("shows through a fresh bootstrap, and takes only the date", () => {
    const shown = withPendingBirths({ ...emptyState(), bootstrap, outbox: [born] }).bootstrap!.children[0];
    expect(shown).toEqual({ id: "baby", name: "Mia", revision: 3, due_date: "2026-12-10", birth_date: "2026-11-05" });
  });
  it("follows the last change, and changes nothing with none queued", () => {
    const back: Mutation = { ...(born as any), id: "u", birth_date: null, previous: "2026-11-05" };
    expect(withPendingBirths({ ...emptyState(), bootstrap, outbox: [born, back] }).bootstrap!.children[0].birth_date).toBeNull();
    const state = { ...emptyState(), bootstrap };
    expect(withPendingBirths(state)).toBe(state);
  });
  it("is decided by the date, never by the revision", () => {
    const child = (birth_date: string | null) => ({ ...bootstrap.children[0], birth_date, revision: 9 }), step = born as Extract<Mutation, { type: "child_birth" }>;
    expect(birthStep(child(null), step)).toBe("send");
    expect(birthStep(child("2026-11-05"), step)).toBe("done");
    expect(birthStep(child("2026-11-04"), step)).toBe("different");
    expect(birthStep(undefined, step)).toBe("gone");
  });
  it("orders behind its own child's changes only, and holds no files", () => {
    expect(mutationRecordId(born)).toBe("baby");
    expect([...uploadedReferences({ ...emptyState(), outbox: [born] })]).toEqual([]);
    expect(pendingRecords({ ...emptyState(), outbox: [born] })).toEqual([]);
  });
});

describe("what a rejected tap means", () => {
  const end = { id: "e", action: "finish" as const, at: "2026-11-04T12:01:00.000Z" }, base = { id: "feed", kind: "feeding" as const, title: "", body: "", child_id: null, occurred_at: end.at, revision: 2, created_at: "", updated_at: "" };
  it("drops only for a record known gone or deliberately untimed", () => {
    expect(rejectedAction(null, end)).toBe("removed");
    expect(rejectedAction({ ...base, data: { method: "breast", state: "finished" } }, end)).toBe("plain");
    expect(rejectedAction({ ...base, data: { method: "bottle" } }, end)).toBe("plain");
  });
  it("counts a tap the record already holds, and keeps anything still timed", () => {
    expect(rejectedAction({ ...base, data: { method: "breast", actions: [end] } }, end)).toBe("applied");
    expect(rejectedAction({ ...base, data: { method: "breast", actions: [{ id: "s", action: "start", at: end.at, side: "left" }] } }, end)).toBe("unresolved");
    expect(rejectedAction({ ...base, data: { method: "breast", state: "unknown_end" } }, end)).toBe("unresolved");
  });
  it("backs off further each try, and no further than five minutes", () => {
    const tap: Extract<Mutation, { type: "feed_action" }> = { id: "e", generation: 1, type: "feed_action", record_id: "feed", action: end }, now = Date.parse(end.at);
    const once = retryLater(tap, now), twice = retryLater(once, now), many = retryLater({ ...tap, attempts: 30 }, now);
    expect(Date.parse(once.hold_until!) - now).toBe(5000);
    expect(Date.parse(twice.hold_until!) - now).toBe(10_000);
    expect(Date.parse(many.hold_until!) - now).toBe(300_000);
    expect(once.id).toBe("e");
  });
});

describe("feed actions in the outbox", () => {
  const action = (id: string, kind: "switch" | "finish", at: string): Extract<Mutation, { type: "feed_action" }> =>
    ({ id, generation: 1, type: "feed_action", record_id: "feed", action: { id, action: kind, at, ...(kind === "switch" ? { side: "right" } : {}) } });
  const create: Mutation = { id: "create", generation: 1, type: "save", files: [], record: { id: "feed", kind: "feeding", title: "Feeding", body: "", child_id: "baby", occurred_at: "2026-11-04T12:00:00.000Z",
    data: { method: "breast", side: "left", state: "running", actions: [{ id: "start", action: "start", at: "2026-11-04T12:00:00.000Z", side: "left" }] } } };
  it("waits behind its record's create, and each action behind the one before", () => {
    const first = action("a", "switch", "2026-11-04T12:05:00.000Z"), second = action("b", "finish", "2026-11-04T12:09:00.000Z"), outbox = [create, first, second];
    expect(mutationRecordId(first)).toBe("feed");
    expect(waitingForEarlier(outbox, first)).toBe(true);
    expect(waitingForEarlier([first, second], first)).toBe(false);
    expect(waitingForEarlier([first, second], second)).toBe(true);
    const other: Mutation = { ...create, id: "other", record: { ...create.record, id: "other-record" } };
    expect(waitingForEarlier([create, other], other)).toBe(false);
  });
  it("shows on the record while queued, offline, and leaves when the record is removed", () => {
    const state = { ...emptyState(), outbox: [create, action("a", "switch", "2026-11-04T12:05:00.000Z"), action("b", "finish", "2026-11-04T12:09:00.000Z")] };
    expect(pendingRecords(state)[0].data).toMatchObject({ state: "finished", side: "both", duration_minutes: 9 });
    const gone: Mutation = { id: "gone", generation: 1, type: "delete", record: { ...create.record, revision: 0, created_at: "", updated_at: "" } };
    expect(pendingRecords({ ...state, outbox: [...state.outbox, gone] })).toEqual([]);
  });
  it("is not changed by a record landing, and does not count as files or a routine", () => {
    const queued = action("a", "finish", "2026-11-04T12:09:00.000Z");
    expect(advancePending(queued, create, { ...create.record, revision: 3, created_at: "", updated_at: "" })).toBe(queued);
    expect([...uploadedReferences({ ...emptyState(), outbox: [queued] })]).toEqual([]);
  });
  it("holds until its Undo window ends, and only then", () => {
    const held = { ...action("a", "finish", "2026-11-04T12:09:00.000Z"), hold_until: "2026-11-04T12:09:06.500Z" }, at = (s: string) => new Date(s).getTime();
    expect(heldUntil(held, at("2026-11-04T12:09:06.000Z"))).toBe(at("2026-11-04T12:09:06.500Z"));
    expect(heldUntil(held, at("2026-11-04T12:09:06.500Z"))).toBe(0);
    expect(heldUntil(action("b", "finish", "2026-11-04T12:09:00.000Z"))).toBe(0);
    expect(heldUntil(create)).toBe(0);
  });
});

describe("what a save was built on", () => {
  const start = { id: "s", action: "start" as const, at: "2026-11-04T12:00:00.000Z", side: "left" as const },
    swap = { id: "swap", generation: 1, type: "feed_action" as const, record_id: "feed", action: { id: "swap", action: "switch" as const, at: "2026-11-04T12:05:00.000Z", side: "right" as const } },
    feed = { ...optimisticRecord({ id: "feed", kind: "feeding", title: "Feeding", body: "", child_id: null, occurred_at: start.at, data: { method: "breast" as const, side: "left" as const, state: "running" as const, actions: [start] } }), revision: 1 },
    state = { ...emptyState(), records: [feed] };
  const queuedNote = (from: typeof state, id = "note") => {
    const shown = pendingRecords(from).find((r) => r.id === "feed")!;
    return addMutation(from, { id, generation: 1, type: "save", files: [], record: { ...shown, body: id } });
  };
  it("records the queued changes it already shows", () => {
    expect(queuedNote(addMutation(state, swap)).outbox[1]).toMatchObject({ base: { after: ["swap"] } });
  });
  it("doesn't give a brand new entry a base", () => {
    expect(addMutation(emptyState(), { id: "new", generation: 1, type: "save", files: [], record: feed }).outbox[0]).not.toHaveProperty("base");
  });
  it("follows only a request it saw", () => {
    const seen = queuedNote(addMutation(state, swap)).outbox[1];
    const unseen = { ...seen, base: { after: [] } };
    const made = { ...feed, revision: 2, data: { ...feed.data, actions: [start, { ...swap.action, revision: 2 }] } };
    expect(advancePending(seen, swap, made)).toMatchObject({ record: { revision: 2 }, base: { after: [] } });
    expect(advancePending(unseen, swap, made)).toBe(unseen);
  });
  it("forgets old outcomes unless a kept draft still needs one, and a new space starts with none", () => {
    let kept = { ...state, drafts: { open: { ...feed, files: [], existing: true, base: { after: ["oldest"] } } } } as any;
    kept = withSettled(kept, "oldest", { made: 2 });
    for (let at = 0; at < 60; at++) kept = withSettled(kept, "change-" + at, { made: at });
    expect(kept.settled.oldest).toEqual({ made: 2 });
    expect(kept.settled["change-0"]).toBeUndefined();
    expect(Object.keys(kept.settled)).toHaveLength(51);
    expect(fencedState({ ...kept, bootstrap: { generation: 1 } }, 2)).not.toHaveProperty("settled");
  });
  describe("discarding a queued change", () => {
    const file = (id: string) => ({ id, uri: id, name: id, mime_type: "image/jpeg", uploaded_id: "up-" + id });
    const save = (id: string, body: string, files: ReturnType<typeof file>[] = [], recordId = "feed") =>
      ({ id, generation: 1, type: "save" as const, files, record: { ...feed, id: recordId, body } });
    const queue = (...changes: any[]) => changes.reduce((at, change) => addMutation(at, change), state as any) as typeof state & { outbox: any[] };
    const ids = (s: { outbox: { id: string }[] }) => s.outbox.map((m) => m.id);
    it("takes every later change to that record with it, feed actions too, and leaves the rest in order", () => {
      const other = save("other", "Another entry", [], "elsewhere"), again = { ...swap, id: "again", action: { ...swap.action, id: "again" } };
      const queued = queue(save("first", "one"), other, swap, save("note", "two"), again);
      expect(queuedChain(queued.outbox, queued.outbox[2]).map((m) => m.id)).toEqual(["swap", "note", "again"]);
      const left = withoutChain(queued, queued.outbox[2]);
      expect(ids(left)).toEqual(["first", "other"]);
      expect(left.settled).toEqual({ swap: { discarded: true }, note: { discarded: true }, again: { discarded: true } });
    });
    it("takes only itself when nothing follows it, and says nothing extra", () => {
      const queued = queue(save("first", "one"), swap);
      expect(ids(withoutChain(queued, queued.outbox[1]))).toEqual(["first"]);
      expect(queuedChain(queued.outbox, queued.outbox[1])).toHaveLength(1);
      expect(laterChangesNotice(0)).toBe("");
      expect(laterChangesNotice(1)).toBe("This also removes 1 later change to this entry.");
      expect(laterChangesNotice(2)).toBe("This also removes 2 later changes to this entry.");
    });
    it("leaves the row exactly as last synced", () => {
      const queued = queuedNote(addMutation(state, swap));
      const left = withoutChain(queued, queued.outbox[0]);
      expect(left.records).toEqual([feed]);
      expect(pendingRecords(left)).toEqual([feed]);
    });
    it("keeps a photo an earlier save still has: A adds X, B and C inherit it, and discarding B leaves A", () => {
      const x = file("x"), queued = queue(save("a", "A", [x]), save("b", "B", [x]), save("c", "C", [x]));
      const left = withoutChain(queued, queued.outbox[1]);
      expect(ids(left)).toEqual(["a"]);
      expect((left.outbox[0] as any).files).toEqual([x]);
      expect(left.fileReleases).toEqual([]);
    });
    it("releases what only the discarded changes referred to, and keeps what a draft or an earlier save does", () => {
      const x = file("x"), y = file("y"), z = file("z");
      const queued = { ...queue(save("a", "A", [x]), save("b", "B", [x, y, z])), drafts: { kept: { ...feed, files: [z], existing: true } } };
      expect(withoutChain(queued, queued.outbox[1]).fileReleases).toEqual(["up-y"]);
      const none = withoutChain({ ...queued, drafts: {} }, queued.outbox[0]);
      expect(none.outbox).toEqual([]);
      expect(none.fileReleases?.sort()).toEqual(["up-x", "up-y", "up-z"]);
    });
    it("can't bring discarded text back, however many times she discards", () => {
      let queued = queue(save("a", "A"), save("b", "A then B"), save("c", "A then B then C"));
      queued = withoutChain(queued, queued.outbox[2]) as typeof queued;
      expect(pendingRecords(queued)[0].body).toBe("A then B");
      queued = withoutChain(queued, queued.outbox[1]) as typeof queued;
      expect(pendingRecords(queued)[0].body).toBe("A");
      queued = withoutChain(queued, queued.outbox[0]) as typeof queued;
      expect(pendingRecords(queued)).toEqual([feed]);
      expect(queued.outbox).toEqual([]);
    });
    it("leaves nothing behind that waits on what went", () => {
      const queued = queue(save("a", "A"), save("b", "B"), save("c", "C")), left = withoutChain(queued, queued.outbox[1]);
      expect(waitingForEarlier(left.outbox, left.outbox[0])).toBe(false);
      const after = addMutation(left, save("new", "Written after"));
      expect(ids(after)).toEqual(["a", "new"]);
      expect(ids(withoutChain(after, after.outbox[0]))).toEqual([]);
    });
    it("proves the revision of a sent tap that turns out to have landed, and forgets the row of one that's gone", () => {
      const queued = queuedNote(addMutation(state, { ...swap, sent: true }));
      const landed = { ...feed, revision: 2, data: { ...feed.data, side: "both" as const, actions: [start, { ...swap.action, revision: 2 }] } };
      const left = withoutChain(queued, queued.outbox[0], landed);
      expect(left.outbox).toEqual([]);
      expect(left.records).toEqual([landed]);
      expect(left.settled).toEqual({ swap: { made: 2 }, note: { discarded: true } });
      expect(withoutChain(queued, queued.outbox[0], null).records).toEqual([]);
      expect(withoutChain(queued, queued.outbox[0], feed).settled?.swap).toEqual({ discarded: true });
    });
    it("still works on a save or draft kept with the longer form an earlier test build wrote", () => {
      const old = { ...save("old", "Kept"), base: { record: feed, after: ["swap"], files: ["x"] } };
      const queued = { ...state, outbox: [swap, old] } as any;
      expect(ids(withoutChain(queued, swap))).toEqual([]);
      const draft = { ...feed, body: "Typing", files: [], existing: true, base: { record: feed, after: ["swap"], files: [] } };
      expect(settledDraft(draft, { ...state, outbox: [], settled: { swap: { files: ["x"] } } } as any)).toMatchObject({ revision: 1, body: "Typing", base: { after: [] } });
      const landed = { ...old, base: { ...old.base, after: ["swap"] } };
      expect(advancePending(landed as any, swap, { ...feed, revision: 2, data: { ...feed.data, actions: [start, { ...swap.action, revision: 2 }] } })).toMatchObject({ record: { revision: 2 } });
    });
    it("loads a save from build 32 with no base at all", () => {
      const old = save("old", "Kept"), queued = { ...state, outbox: [old, swap] } as any;
      expect(ids(withoutChain(queued, old))).toEqual([]);
      expect(ids(withoutChain(queued, swap))).toEqual(["old"]);
    });
  });
  describe("a draft built on a change that has left", () => {
    const draftOn = (from: DeviceState, over: object = {}) => {
      const shown = pendingRecords(from).find((r) => r.id === "feed")!;
      return { ...shown, files: [], existing: true, base: baseOf(from, "feed"), body: "Typing", title: "Mine", ...over };
    };
    it("is left alone until one has", () => {
      const queued = addMutation(state, swap), draft = draftOn(queued);
      expect(settledDraft(draft, queued)).toBe(draft);
    });
    it("moves one revision for a change it saw land, and keeps everything she wrote", () => {
      const queued = addMutation(state, swap), draft = draftOn(queued);
      const settled = settledDraft(draft, withSettled({ ...state, outbox: [], records: [{ ...feed, revision: 2 }] }, "swap", { made: 2 }));
      expect(settled).toEqual({ ...draft, revision: 2, base: { after: [] } });
    });
    it("doesn't move for the row, or for a revision that isn't the next one", () => {
      const queued = addMutation(state, swap), draft = draftOn(queued);
      const skipped = withSettled({ ...state, outbox: [], records: [{ ...feed, revision: 7 }] }, "swap", { made: 5 });
      expect(settledDraft(draft, skipped).revision).toBe(1);
      expect(settledDraft(draft, { ...state, outbox: [], records: [{ ...feed, revision: 7 }] }).revision).toBe(1);
    });
    it("keeps every word and photo when the change is discarded, and only its revision and list move", () => {
      const x = { id: "x", uri: "x", name: "x", mime_type: "image/jpeg" };
      const queued = addMutation(state, swap), draft = { ...draftOn(queued), files: [x] };
      const settled = settledDraft(draft, withoutChain(queued, queued.outbox[0]));
      expect(settled).toEqual({ ...draft, revision: 1, base: { after: [] } });
    });
    it("goes back to the saved row's revision, and never up to one it hasn't seen", () => {
      const queued = addMutation(state, swap), draft = { ...draftOn(queued), revision: 4 };
      expect(settledDraft(draft, withoutChain(queued, queued.outbox[0])).revision).toBe(1);
      const moved = withoutChain(queued, queued.outbox[0], { ...feed, revision: 6, body: "From the other phone" });
      expect(settledDraft(draftOn(queued), moved).revision).toBe(1);
    });
    it("becomes a plain new entry when what it was built on was the create", () => {
      const create = { id: "create", generation: 1, type: "save" as const, files: [], record: { ...feed, revision: undefined } };
      const queued = addMutation(emptyState(), create), draft = draftOn(queued as typeof state);
      const settled = settledDraft(draft, withoutChain(queued, queued.outbox[0]));
      expect(settled.revision).toBeFalsy();
      expect(settled).toMatchObject({ body: "Typing", base: { after: [] } });
    });
    it("follows what's left after the discarded part of its chain goes", () => {
      const queued = queuedNote(addMutation(state, swap)), draft = draftOn(queued);
      const left = withoutChain(queued, queued.outbox[1]), settled = settledDraft(draft, left);
      expect(settled).toMatchObject({ revision: 1, base: { after: ["swap"] } });
      const landed = withSettled({ ...left, outbox: [], records: [{ ...feed, revision: 2 }] }, "swap", { made: 2 });
      expect(settledDraft(settled, landed)).toMatchObject({ revision: 2, base: { after: [] } });
    });
  });
  describe("what an edit to a feed sends", () => {
    const swapped = pendingRecords(addMutation(state, swap)).find((r) => r.id === "feed")!;
    it("leaves out what only follows from its taps, so a discarded Switch can't finish the feed", () => {
      expect(swapped.data.side).toBe("both");
      const sent = feedEdit({ ...swapped, body: "Sleepy" });
      expect(sent).toMatchObject({ body: "Sleepy", revision: 1 });
      for (const key of ["actions", "state", "side", "duration_minutes", "end_at"]) expect(sent.data).not.toHaveProperty(key);
    });
    it("sends a side or duration she changed by hand", () => {
      const fixed = { ...swapped, data: { ...swapped.data, side: "right" as const } };
      expect(feedEdit(fixed)).toBe(fixed);
      const timed = { ...swapped, data: { ...swapped.data, duration_minutes: 12 } };
      expect(feedEdit(timed)).toBe(timed);
    });
    it("sends a new feed and anything else whole", () => {
      const created = { ...swapped, revision: undefined };
      expect(feedEdit(created)).toBe(created);
      const bottle = { ...feed, data: { method: "bottle" as const, amount: 3, unit: "oz" as const } };
      expect(feedEdit(bottle)).toBe(bottle);
    });
  });
});

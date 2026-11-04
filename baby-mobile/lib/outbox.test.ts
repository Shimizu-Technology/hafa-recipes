import { describe, it, expect } from "vitest";
import type { BabyRecord } from "./models";
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
  withoutPredecessor,
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
  it("records the copy and the queued changes it already shows", () => {
    const after = queuedNote(addMutation(state, swap));
    expect(after.outbox[1]).toMatchObject({ base: { after: ["swap"], record: { body: "", data: { side: "both" } } } });
  });
  it("doesn't give a brand new entry a base", () => {
    expect(addMutation(emptyState(), { id: "new", generation: 1, type: "save", files: [], record: feed }).outbox[0]).not.toHaveProperty("base");
  });
  it("follows only a request it saw", () => {
    const seen = queuedNote(addMutation(state, swap)).outbox[1];
    const unseen = { ...seen, base: { ...(seen as any).base, after: [] } };
    const made = { ...feed, revision: 2, data: { ...feed.data, actions: [start, { ...swap.action, revision: 2 }] } };
    expect(advancePending(seen, swap, made)).toMatchObject({ record: { revision: 2 }, base: { after: [] } });
    expect(advancePending(unseen, swap, made)).toBe(unseen);
  });
  it("sends one that can't be rebuilt to review rather than guessing", () => {
    const legacy = { id: "old", generation: 1, type: "save" as const, files: [], record: { ...feed, body: "Older build" } };
    const left = withoutPredecessor({ ...state, outbox: [swap, legacy] }, swap);
    expect(left.outbox).toEqual([expect.objectContaining({ id: "old", conflict: true })]);
    const unread = withoutPredecessor({ ...queuedNote(addMutation(state, swap)), records: [] }, swap);
    expect(unread.outbox[0]).toMatchObject({ id: "note", conflict: true });
  });
  it("leaves a save alone that never had the discarded change in it", () => {
    const first = queuedNote(state), kept = addMutation(first, swap);
    expect(withoutPredecessor(kept, swap).outbox).toEqual([first.outbox[0]]);
  });
  it("lets a later change become a create when the discarded one was its create", () => {
    const create = { id: "create", generation: 1, type: "save" as const, files: [], record: { ...feed, revision: undefined } };
    const queued = queuedNote(addMutation(emptyState(), create));
    const left = withoutPredecessor(queued, create);
    expect(left.outbox).toEqual([expect.objectContaining({ id: "note", record: expect.objectContaining({ body: "note" }), base: expect.objectContaining({ after: [] }) })]);
    expect((left.outbox[0] as any).conflict).toBeUndefined();
  });
  it("drops the files it inherited from a discarded change, and keeps its own", () => {
    const file = (id: string) => ({ id, uri: id, name: id, mime_type: "image/jpeg" });
    const first = { id: "first", generation: 1, type: "save" as const, files: [file("theirs")], record: { ...feed, title: "With a photo" } };
    const queued = addMutation(state, first), base = baseOf(queued, pendingRecords(queued).find((r) => r.id === "feed")!);
    const second = { id: "second", generation: 1, type: "save" as const, files: [file("theirs"), file("mine")], record: { ...feed, title: "With a photo" }, base };
    const left = withoutPredecessor(addMutation(queued, second), first);
    expect((left.outbox[0] as any).files.map((f: { id: string }) => f.id)).toEqual(["mine"]);
    expect((left.outbox[0] as any).record.title).toBe("Feeding");
    expect(left.settled?.first.files).toEqual(["theirs"]);
  });
  it("keeps a removed record's id out of a rebuilt save, and forgets the row", () => {
    const queued = queuedNote(addMutation(state, swap));
    const left = withoutPredecessor(queued, swap, null);
    expect(left.records).toEqual([]);
    expect(left.outbox[0]).toMatchObject({ id: "note", record: { body: "note" }, base: { after: [] } });
  });
  it("moves a later change by the proof a landed tap gives, when a sent tap is discarded", () => {
    const landed = { ...feed, revision: 2, data: { ...feed.data, side: "both" as const, actions: [start, { ...swap.action, revision: 2 }] } };
    const queued = queuedNote(addMutation(state, { ...swap, sent: true }));
    const left = withoutPredecessor(queued, queued.outbox[0], landed);
    expect(left.outbox[0]).toMatchObject({ record: { revision: 2, body: "note", data: { side: "both" } } });
    expect(left.settled?.swap).toEqual({ made: 2 });
  });
  it("keeps what's still queued in the rebuilt copy", () => {
    const other = { ...swap, id: "other", action: { ...swap.action, id: "other", at: "2026-11-04T12:06:00.000Z", side: "left" as const } };
    const queued = queuedNote(addMutation(addMutation(state, swap), other));
    const left = withoutPredecessor(queued, queued.outbox[0]);
    expect((left.outbox[1] as any).record.data.actions.map((a: { id: string }) => a.id)).toEqual(["s", "other"]);
    expect((left.outbox[1] as any).base.after).toEqual(["other"]);
  });
  it("forgets old outcomes unless a kept draft still needs one, and a new space starts with none", () => {
    let kept = { ...state, drafts: { open: { ...feed, files: [], existing: true, base: { record: feed, after: ["oldest"], files: [] } } } } as any;
    kept = withSettled(kept, "oldest", { made: 2 });
    for (let at = 0; at < 60; at++) kept = withSettled(kept, "change-" + at, { made: at });
    expect(kept.settled.oldest).toEqual({ made: 2 });
    expect(kept.settled["change-0"]).toBeUndefined();
    expect(Object.keys(kept.settled)).toHaveLength(51);
    expect(fencedState({ ...kept, bootstrap: { generation: 1 } }, 2)).not.toHaveProperty("settled");
  });
  it("leaves a draft alone until something it was built on has settled", () => {
    const queued = addMutation(state, swap), shown = pendingRecords(queued).find((r) => r.id === "feed")!;
    const draft = { ...shown, files: [], existing: true, base: baseOf(queued, shown), body: "Typing" };
    expect(settledDraft(draft, queued)).toBe(draft);
    const settled = settledDraft(draft, withSettled({ ...state, outbox: [], records: [{ ...feed, revision: 2, data: shown.data }] }, "swap", { made: 2 }));
    expect(settled).toMatchObject({ revision: 2, body: "Typing", base: { after: [] } });
  });
});

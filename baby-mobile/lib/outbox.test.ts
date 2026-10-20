import { describe, it, expect } from "vitest";
import {
  addMutation,
  fencedState,
  pendingRecords,
  searchLocal,
  shouldRetry,
  inheritedFiles,
  advancePending,
  queueRemovedUploads,
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
  it("automatically retries transient failures and requires review for conflicts or denied access", () => {
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
    const saved = { ...row, revision: 4, data: { attachment_ids: ["server-attachment"] } },
      file = { id: "local-photo", uri: "file:///private/photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" };
    const correction: Mutation = {
      id: "save-b",
      type: "save",
      generation: 1,
      record: { ...row, body: "edited while offline" },
      files: [file],
    };
    expect(advancePending(correction, saved)).toMatchObject({
      record: { revision: 4, body: "edited while offline" },
      files: [file],
    });
    expect(advancePending({ id: "delete", type: "delete", generation: 1, record: row }, saved)).toMatchObject({
      record: { revision: 4 },
    });
  });
});

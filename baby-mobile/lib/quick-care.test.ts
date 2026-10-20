import { expect, it, vi } from "vitest";
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
import { careWrite, logCare, updateCare } from "./quick-care";
import { advancePending, pendingRecords } from "./outbox";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";

function account() {
  const b = {
    state: { ...emptyState(), bootstrap: { generation: 3, active: true, ai_available: false, children: [],
      profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    queue: async (m: Mutation) => { b.state = { ...b.state, outbox: [...b.state.outbox, m] }; },
    commit: async (change: (state: DeviceState) => DeviceState) => { b.state = change(b.state); },
    sync: async () => undefined,
  };
  return b;
}

it("cancels an unsynced one-tap log locally through ordered outbox changes", async () => {
  const b = account();
  const undo = await logCare(b, careWrite("diaper", "baby", { type: "wet" }));
  expect(pendingRecords(b.state).map((r) => r.kind)).toEqual(["diaper"]);
  await undo();
  expect(pendingRecords(b.state)).toEqual([]);
  expect(b.state.outbox.map((m) => m.type)).toEqual(["save", "delete"]);
  // When the save syncs first, the queued delete carries the revision it produced.
  const saved = b.state.outbox[0] as Extract<Mutation, { type: "save" }>;
  const server = { ...saved.record, revision: 1, created_at: "", updated_at: "" } as BabyRecord;
  expect((advancePending(b.state.outbox[1], server) as Extract<Mutation, { type: "delete" }>).record.revision).toBe(1);
});

it("restores an open sleep when finishing it is undone", async () => {
  const b = account(),
    open = { ...careWrite("sleep", "baby", {}), revision: 4, created_at: "", updated_at: "" } as BabyRecord;
  b.state = { ...b.state, records: [open] };
  const undo = await updateCare(b, open, { end_at: "2026-10-20T10:00:00.000Z" });
  expect(pendingRecords(b.state)[0].data.end_at).toBe("2026-10-20T10:00:00.000Z");
  await undo();
  expect(pendingRecords(b.state)[0].data.end_at).toBeUndefined();
  expect(b.state.outbox.every((m) => m.generation === 3)).toBe(true);
});

it("removes an already-synced log at the revision the server returned", async () => {
  const b = account();
  const write = careWrite("feeding", "baby", { method: "breast", side: "left" });
  const undo = await logCare(b, write);
  // The save syncs before Undo is tapped.
  b.state = { ...b.state, outbox: [], records: [{ ...write, revision: 1, created_at: "", updated_at: "" } as BabyRecord] };
  await undo();
  const removed = b.state.outbox[0] as Extract<Mutation, { type: "delete" }>;
  expect(removed.type).toBe("delete");
  expect(removed.record.revision).toBe(1);
});

it("restores a synced sleep at its newest revision", async () => {
  const b = account(),
    open = { ...careWrite("sleep", "baby", {}), revision: 4, created_at: "", updated_at: "" } as BabyRecord;
  b.state = { ...b.state, records: [open] };
  const undo = await updateCare(b, open, { end_at: "2026-10-20T10:00:00.000Z" });
  b.state = { ...b.state, outbox: [], records: [{ ...open, revision: 5, data: { end_at: "2026-10-20T10:00:00.000Z" } }] };
  await undo();
  const restored = b.state.outbox[0] as Extract<Mutation, { type: "save" }>;
  expect(restored.record.revision).toBe(5);
  expect(restored.record.data.end_at).toBeUndefined();
});

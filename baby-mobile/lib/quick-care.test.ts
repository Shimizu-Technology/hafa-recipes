import { describe, expect, it, vi } from "vitest";
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
import { bottleStart, careWrite, changeUnit, lastAmountUnit, logCare, pumpStart, pumpStep, stepAmount, updateCare } from "./quick-care";
import { advancePending, pendingRecords } from "./outbox";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";

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
  expect((advancePending(b.state.outbox[1], saved, server) as Extract<Mutation, { type: "delete" }>).record.revision).toBe(1);
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

it("applies an alongside change in the same write as the save, or neither", async () => {
  const b = account();
  b.state = { ...b.state, selectedChild: "kept" };
  await logCare(b, careWrite("feeding", "baby", { method: "breast" }), (state) => ({ ...state, selectedChild: "changed" }));
  expect(b.state.selectedChild).toBe("changed");
  expect(b.state.outbox).toHaveLength(1);
  await expect(
    logCare(b, careWrite("feeding", "baby", { method: "breast" }), () => {
      throw Error("already ended");
    })
  ).rejects.toThrow("already ended");
  expect(b.state.outbox).toHaveLength(1);
});

describe("which unit an amount starts in", () => {
  const log = (kind: "feeding" | "pumping", unit: "oz" | "ml", amount: number, child = "baby", at = "2026-11-03T00:00:00.000Z") =>
    optimisticRecord({ id: `${kind}-${unit}-${at}-${child}`, kind, title: "", body: "", child_id: child, occurred_at: at, data: { ...(kind === "feeding" ? { method: "bottle" } : {}), amount, unit } });
  it("is ounces before anything's logged", () => {
    expect(bottleStart([], "baby")).toMatchObject({ unit: "oz", amount: 3, fromLast: false });
    expect(pumpStart([], "baby")).toMatchObject({ unit: "oz", amount: 3, fromLast: false });
  });
  it("is the last one's, for a bottle or for pumping", () => {
    expect(bottleStart([log("feeding", "ml", 120)], "baby")).toMatchObject({ unit: "ml", amount: 120, fromLast: true });
    expect(pumpStart([log("pumping", "ml", 60)], "baby")).toMatchObject({ unit: "ml", amount: 60, fromLast: true });
  });
  it("carries over from the other when one has no history, or from another baby", () => {
    expect(bottleStart([], "baby", "ml")).toMatchObject({ unit: "ml", amount: 90, fromLast: false });
    expect(pumpStart([], "baby", "ml")).toMatchObject({ unit: "ml", amount: 90, fromLast: false });
    expect(bottleStart([log("feeding", "oz", 4)], "baby", "ml")).toMatchObject({ unit: "oz", amount: 4 });
  });
  it("finds the unit she last used, across bottles, pumping and babies", () => {
    expect(lastAmountUnit([])).toBeUndefined();
    expect(lastAmountUnit([log("feeding", "oz", 4, "baby", "2026-11-01T00:00:00.000Z"), log("pumping", "ml", 60, "sister", "2026-11-02T00:00:00.000Z")])).toBe("ml");
  });
  it("converts sensibly both ways, and comes back to where it started", () => {
    const there = changeUnit({ amount: 3, unit: "oz" });
    expect(there).toMatchObject({ amount: 90, unit: "ml" });
    expect(changeUnit(there)).toEqual({ amount: 3, unit: "oz" });
    expect(changeUnit({ amount: 4.5, unit: "oz" })).toMatchObject({ amount: 140, unit: "ml" });
    expect(changeUnit({ amount: 2.25, unit: "oz" }, pumpStep).amount % 5).toBe(0);
    expect(changeUnit(changeUnit({ amount: 2.25, unit: "oz" }, pumpStep), pumpStep)).toEqual({ amount: 2.25, unit: "oz" });
  });
  it.each([
    [10, undefined], [5, undefined], [5, pumpStep], [10, pumpStep], [7, pumpStep], [15, undefined],
  ])("switching twice gives back %s mL exactly", (amount, steps) => {
    const there = changeUnit({ amount, unit: "ml" }, steps);
    expect(there.unit).toBe("oz");
    expect(changeUnit(there, steps)).toEqual({ amount, unit: "ml" });
  });
  it("is stable however many times she switches", () => {
    let choice: ReturnType<typeof changeUnit> = { amount: 10, unit: "ml" };
    for (let n = 0; n < 6; n++) choice = changeUnit(choice);
    expect(choice).toEqual({ amount: 10, unit: "ml" });
  });
  it("a step counts from what's on screen, and leaves nothing to restore", () => {
    const there = changeUnit({ amount: 10, unit: "ml" });
    const stepped = { amount: stepAmount(there, 1), unit: there.unit };
    expect(stepped).toEqual({ amount: 1, unit: "oz" });
    expect(changeUnit(stepped)).toMatchObject({ amount: 30, unit: "ml" });
  });
});

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type Child, type DeviceState, type RecordPage, type Relevance } from "./models";
import { pendingRecords } from "./outbox";

const scope = vi.hoisted(() => ({ account: null as any }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return { useFocusEffect: (callback: () => (() => void) | undefined) => React.useEffect(() => callback(), [callback]) };
});
vi.mock("./context", () => ({ useBaby: () => scope.account }));
import { useTimingTips } from "./use-timing-tips";

const today = new Date(2026, 10, 1);
const kami: Child = { id: "isla", name: "Isla", due_date: "2026-12-10", revision: 1 };
const tip = (id: string, relevance: Relevance | null): BabyRecord => ({ ...optimisticRecord({ id, kind: "source", title: id, body: "", child_id: null,
  occurred_at: "2026-10-20T00:00:00Z", data: { status: "ready", relevance } }), revision: 2 });
let renderer: ReactTestRenderer | undefined, seen: string[] = [];

function account(records: BabyRecord[], response: () => Promise<RecordPage>) {
  const value: any = {
    owner: "kami", state: { ...emptyState(), records, bootstrap: { generation: 2, active: true, ai_available: false, children: [kami],
      profile: { display_name: "Kami", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    get records() { return pendingRecords(value.state); },
    api: { lease: () => 1, assertLease: () => undefined, records: vi.fn(response) },
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { value.state = change(value.state); }),
  };
  scope.account = value;
  return value;
}
function Probe({ child, mode }: { child: Child | null; mode: "now" | "upcoming" }) {
  seen = useTimingTips(child, mode, 5, today).rows.map((row) => row.id);
  return null;
}
async function mount(child: Child | null = kami, mode: "now" | "upcoming" = "now") {
  await act(async () => { renderer = create(<Probe child={child} mode={mode} />); });
}
const save = (record: BabyRecord) => ({ type: "save" as const, id: `m-${record.id}`, record, attempts: 0 });

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); seen = []; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });

it("keeps the server's order but overlays unsynced timing edits, as Saved does", async () => {
  const bag = tip("bag", { pregnancy_week_min: 34, pregnancy_week_max: 36 }), sleep = tip("sleep", { stage: "pregnancy" }),
    tea = tip("tea", { pregnancy_week_min: 37 });
  const b = account([bag, sleep, tea], async () => ({ items: [sleep, bag], total: 2, has_more: false }));
  // The parent cleared the bag's timing and moved the tea tip to "from 30 weeks" on this phone; neither has synced.
  b.state.outbox = [save({ ...bag, data: { ...bag.data, relevance: null } }), save({ ...tea, data: { ...tea.data, relevance: { pregnancy_week_min: 30 } } })];
  await mount();
  expect(b.api.records).toHaveBeenCalledWith({ kind: "source", timing: "now", timing_child_id: "isla", limit: 5 });
  expect(seen).toEqual(["tea", "sleep"]);
});

it("ignores a response that arrives after the account space changed", async () => {
  let resolve!: (page: RecordPage) => void;
  const fresh = tip("fresh", { stage: "pregnancy" });
  const b = account([], () => new Promise((done) => { resolve = done; }));
  await mount();
  b.state = { ...b.state, bootstrap: { ...b.state.bootstrap!, generation: 3 } };
  await act(async () => resolve({ items: [fresh], total: 1, has_more: false }));
  expect(b.state.records).toEqual([]);
});

it("makes no request and shows nothing once the due date is stale", async () => {
  const b = account([tip("sleep", { stage: "pregnancy" })], async () => ({ items: [], total: 0, has_more: false }));
  await mount({ ...kami, due_date: "2026-09-01" });
  expect(b.api.records).not.toHaveBeenCalled();
  expect(seen).toEqual([]);
});

it("answers from this phone, soonest first, when the request fails", async () => {
  const b = account([tip("labor", { pregnancy_week_min: 38 }), tip("colostrum", { pregnancy_week_min: 36 }), tip("now", { stage: "pregnancy" })],
    async () => { throw new Error("offline"); });
  await mount(kami, "upcoming");
  expect(b.api.records).toHaveBeenCalled();
  expect(seen).toEqual(["colostrum", "labor"]);
});

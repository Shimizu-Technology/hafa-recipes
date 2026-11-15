import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState } from "./models";

const w = vi.hoisted(() => ({ baby: null as any, consent: true, pages: [] as any[] }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${Math.random()}` }));
vi.mock("@/lib/context", () => ({ useBaby: () => w.baby }));
vi.mock("@/lib/ai-consent", () => ({ ensureAiConsent: async () => w.consent }));
vi.mock("../components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", Notice: "Notice", useColors: () => ({ progressTrack: "#eee", progressFill: "#a55" }) }));
import { OrganizeWaiting } from "../components/organize-waiting";

const post = (id: string): BabyRecord => ({ id, kind: "source", title: id, body: "", child_id: null, occurred_at: "2026-11-01T00:00:00.000Z",
  revision: 1, created_at: "", updated_at: "", data: { url: `https://example.com/${id}`, status: "saved", topics: [] } } as BabyRecord);
let renderer: ReactTestRenderer | undefined;
const text = () => JSON.stringify(renderer!.toJSON());
const button = (title: string) => renderer!.root.findAll((node) => (node.type as unknown) === "Button" && node.props.title === title)[0];
function baby(over: Partial<DeviceState["bootstrap"]> = {}) {
  let state: DeviceState = { ...emptyState(), bootstrap: { generation: 2, ai_available: true, profile: { ai_consent: true }, ...over } as DeviceState["bootstrap"] };
  const b: any = {
    get state() { return state; }, current: () => true, sync: vi.fn(async () => undefined),
    api: { records: vi.fn(async ({ offset }: { offset: number }) => w.pages[offset / 100]) },
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { state = change(state); }),
  };
  return b;
}
const mount = async () => { await act(async () => { renderer = create(<OrganizeWaiting />); }); };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); w.consent = true; w.pages = [{ items: [post("a"), post("b")], has_more: false }]; w.baby = baby(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("offers to organize what's waiting, and starts on one tap", async () => {
  await mount();
  expect(text()).toContain("2 saved posts are waiting to be organized");
  await act(async () => { await button("Organize all 2").props.onPress(); });
  expect(w.baby.state.outbox.map((m: any) => m.record_id)).toEqual(["a", "b"]);
  expect(w.baby.sync).toHaveBeenCalled();
  renderer!.update(<OrganizeWaiting />);
  expect(text()).toContain("Organizing 2 saved posts");
  expect(button("Stop after these")).toBeTruthy();
});
it("does nothing when she keeps AI off", async () => {
  w.consent = false;
  await mount();
  await act(async () => { await button("Organize all 2").props.onPress(); });
  expect(w.baby.state.outbox).toHaveLength(0);
  expect(w.baby.state.organizeRun).toBeUndefined();
});
it("isn't there with nothing waiting, without AI, or for a caregiver", async () => {
  w.pages = [{ items: [{ ...post("a"), data: { ...post("a").data, status: "ready" } }], has_more: false }];
  await mount();
  expect(renderer!.toJSON()).toBeNull();
  await act(async () => renderer!.unmount());
  w.pages = [{ items: [post("a")], has_more: false }];
  w.baby = baby({ ai_available: false });
  await mount();
  expect(renderer!.toJSON()).toBeNull();
  await act(async () => renderer!.unmount());
  w.baby = baby({ spaces: [{ id: "f", kind: "family", role: "caregiver", generation: 1, access_version: 1 }] } as any);
  await mount();
  expect(renderer!.toJSON()).toBeNull();
  expect(w.baby.api.records).not.toHaveBeenCalled();
});
it("after the daily limit, says when instead of offering a tap the API would refuse", async () => {
  w.baby = baby({ profile: { ai_consent: true, timezone: "Pacific/Guam" } } as any);
  const until = new Date(Date.now() + 20 * 3600_000).toISOString();
  await w.baby.commit((s: DeviceState) => ({ ...s, organizeHeldUntil: until }));
  await mount();
  expect(text()).toContain("2 saved posts are waiting to be organized");
  expect(text()).toContain("Today’s processing allowance is used. You can organize them after");
  expect(button("Organize all 2")).toBeUndefined();
  await act(async () => renderer!.unmount());
  // Once it's passed, it's offered again.
  await w.baby.commit((s: DeviceState) => ({ ...s, organizeHeldUntil: new Date(Date.now() - 1000).toISOString() }));
  await mount();
  expect(button("Organize all 2")).toBeTruthy();
});
it("looks again when a waiting post reaches this phone after the first look", async () => {
  w.pages = [{ items: [], has_more: false }];
  w.baby.records = [];
  await mount();
  expect(renderer!.toJSON()).toBeNull();
  // A share syncs: it's on the phone now, and on the API.
  w.pages = [{ items: [post("a")], has_more: false }];
  w.baby.records = [post("a")];
  await act(async () => { renderer!.update(<OrganizeWaiting />); });
  expect(text()).toContain("1 saved post is waiting to be organized");
});
it("tries again after a look that failed, instead of waiting for a pull to refresh", async () => {
  vi.useFakeTimers();
  let fail = true;
  w.baby.api.records = vi.fn(async () => { if (fail) throw new Error("offline"); return { items: [post("a")], has_more: false }; });
  await mount();
  expect(renderer!.toJSON()).toBeNull();
  fail = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
  expect(text()).toContain("1 saved post is waiting to be organized");
  vi.useRealTimers();
});
it("carries a run on from the app root when an import finishes", async () => {
  const { OrganizeRunner } = await import("../components/organize-waiting");
  await mount();
  await act(async () => { await button("Organize all 2").props.onPress(); });
  const [first] = w.baby.state.organizeRun.active;
  await w.baby.commit((s: DeviceState) => ({ ...s, outbox: s.outbox.filter((m) => m.id !== first.import_id),
    imports: [{ id: first.import_id, status: "ready", record_id: first.record_id }] }));
  await act(async () => renderer!.unmount());
  await act(async () => { renderer = create(<OrganizeRunner />); });
  expect(w.baby.state.organizeRun).toMatchObject({ organized: 1 });
  expect(w.baby.sync).toHaveBeenCalled();
});

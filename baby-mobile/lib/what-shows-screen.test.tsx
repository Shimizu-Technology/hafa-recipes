import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type Child, type DeviceState, type Mutation } from "./models";
import { withPendingTracking } from "./outbox";
import { trackersFor } from "./trackers";

const scope = vi.hoisted(() => ({ account: null as any, params: {} as Record<string, string>, push: vi.fn(), announced: [] as string[] }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Switch: "Switch", useWindowDimensions: () => ({ fontScale: 1 }), AccessibilityInfo: { announceForAccessibility: (text: string) => scope.announced.push(text) } }));
vi.mock("expo-router", () => ({ router: { push: scope.push }, useLocalSearchParams: () => scope.params }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("@/lib/api", () => ({ sendsCareDetails: true }));
vi.mock("@/components/ui", () => ({ Chips: "Chips", Copy: "Copy", Grouped: "Grouped", Icon: "Icon", Notice: "Notice", Row: "Row", Screen: "Screen", fonts: {}, typeScale: {}, useColors: () => ({}), useToast: () => vi.fn(), tap: () => undefined }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
import WhatShows from "../app/what-shows";

const newborn: Child = { id: "baby", name: "Mia", revision: 1, birth_date: "2026-11-01" };
let renderer: ReactTestRenderer | undefined;
function setup(children: Child[]) {
  const b = {
    online: true,
    state: { ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false, children, profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { b.state = withPendingTracking(change(b.state)); }),
    queue: vi.fn(async (m: Mutation) => { b.state = withPendingTracking({ ...b.state, outbox: [...b.state.outbox, m] }); }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = b;
  return b;
}
async function mount() { await act(async () => { renderer = create(<WhatShows />); }); }
const refresh = async () => act(async () => renderer!.update(<WhatShows />));
const switches = () => renderer!.root.findAll((n) => String(n.type) === "Switch");
const named = (label: string) => switches().find((n) => n.props.accessibilityLabel === label)!;
async function flip(label: string, value: boolean) { await act(async () => { await named(label).props.onValueChange(value); }); await refresh(); }
const words = () => renderer!.root.findAll((n) => ["Copy", "Notice", "Text"].includes(String(n.type))).map((n) => [n.props.children].flat().join("")).join(" ");
const queued = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "child_tracking");

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers({ now: new Date("2026-11-04T17:00:00.000Z") }); scope.params = {}; scope.announced = []; scope.push.mockClear(); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("What shows", () => {
  it("lists every tracker for this stage as a plain switch, set from the defaults", async () => {
    setup([newborn]);
    await mount();
    expect(switches().map((n) => n.props.accessibilityLabel).sort()).toEqual(trackersFor("born").map((t) => t.label).sort());
    expect(named("Diaper").props.value).toBe(true);
    expect(named("Pumping").props.value).toBe(false);
  });
  it("says plainly that off only hides the button", async () => {
    setup([newborn]);
    await mount();
    expect(words()).toContain("stays in Tracker, Stats, the doctor summary and history");
  });
  it("feels instant: the switch moves with the tap, and it's queued for the API", async () => {
    const b = setup([newborn]);
    await mount();
    await flip("Diaper", false);
    expect(named("Diaper").props.value).toBe(false);
    expect(queued()).toEqual([expect.objectContaining({ child_id: "baby", tracking: { diaper: false }, previous: { diaper: null } })]);
    expect(b.sync).toHaveBeenCalled();
  });
  it("gathers quick changes into one, and a tap back still lands right", async () => {
    setup([newborn]);
    await mount();
    await flip("Diaper", false);
    await flip("Sleep", false);
    await flip("Diaper", true);
    expect(queued()).toHaveLength(1);
    expect(queued()[0].tracking).toEqual({ diaper: true, sleep: false });
    expect(queued()[0].previous).toEqual({ diaper: null, sleep: null });
  });
  it("doesn't add to a change already on its way, which would be lost when it lands", async () => {
    const b = setup([newborn]);
    await mount();
    await flip("Diaper", false);
    b.state = { ...b.state, outbox: b.state.outbox.map((m) => ({ ...m, sent: true }) as Mutation) };
    await flip("Sleep", false);
    expect(queued().map((m: any) => m.tracking)).toEqual([{ diaper: false }, { sleep: false }]);
  });
  it("says it's on this phone while it's offline", async () => {
    const b = setup([newborn]);
    b.online = false;
    await mount();
    expect(words()).not.toContain("on this phone");
    await flip("Diaper", false);
    expect(words()).toContain("Saved on this phone");
    expect(named("Diaper").props.value).toBe(false);
  });
  it("shows the baby it was opened for, and lets her choose with two", async () => {
    setup([newborn, { ...newborn, id: "two", name: "Kai", details: { tracking: { diaper: false } } }]);
    scope.params = { child: "two" };
    await mount();
    expect(named("Diaper").props.value).toBe(false);
    const chips = renderer!.root.findByType("Chips" as any);
    expect(chips.props.value).toBe("two");
    await act(async () => chips.props.onChange("baby"));
    expect(named("Diaper").props.value).toBe(true);
    await flip("Sleep", false);
    expect(queued()[0].child_id).toBe("baby");
  });
  it("has no chooser with one baby", async () => {
    setup([newborn]);
    await mount();
    expect(renderer!.root.findAll((n) => String(n.type) === "Chips")).toHaveLength(0);
  });
  it("has her own logs under their own heading", async () => {
    setup([newborn]);
    await mount();
    expect(words()).toContain("For Mia");
    expect(words()).toContain("For you");
  });
  it("offers set-up, not switches, with no baby", async () => {
    setup([]);
    await mount();
    expect(switches()).toHaveLength(0);
    await act(async () => renderer!.root.findByType("Row" as any).props.onPress());
    expect(scope.push).toHaveBeenCalledWith("/child");
  });
});

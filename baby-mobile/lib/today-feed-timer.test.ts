import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";

const scope = vi.hoisted(() => ({
  account: null as unknown,
  care: [] as unknown[],
  sheets: [] as { options: string[]; pick: (index: number) => void }[],
  alerts: [] as { title: string; buttons: { text: string; onPress?: () => void }[] }[],
  toast: vi.fn(),
  push: vi.fn(),
  haptic: vi.fn(async () => undefined),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" }, View: "View", Pressable: "Pressable", Text: "Text",
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  ActionSheetIOS: { showActionSheetWithOptions: (config: { options: string[] }, pick: (index: number) => void) =>
    scope.sheets.push({ options: config.options, pick }) },
  Alert: { alert: (title: string, _message: string, buttons = []) => scope.alerts.push({ title, buttons }) },
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return { router: { push: scope.push },
    useFocusEffect: (callback: () => (() => void) | undefined) => React.useEffect(() => callback(), [callback]) };
});
vi.mock("expo-haptics", () => ({ notificationAsync: scope.haptic, NotificationFeedbackType: { Success: "success" } }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `fixture-${++id}` }; });
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/today-care", () => ({
  useTodayCare: () => ({ rows: [], all: scope.care, loading: false, error: "", refresh: vi.fn() }),
}));
const ui = vi.hoisted(() => ({
  PressTarget: "Pressable", Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Icon: "Icon", Loading: "Loading", Notice: "Notice",
  Screen: "Screen", Row: "Row", Section: "Section", useColors: () => ({ text: "#000", hero: "#fff" }), useToast: () => scope.toast,
  fonts: { regular: "r", semibold: "s", bold: "b" },
}));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("@/components/record-row", () => ({ RecordRow: "RecordRow", kindIcon: { feeding: "f", sleep: "s", diaper: "d" } }));
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/components/care-glance", () => ({ CareGlance: "CareGlance", useMinuteClock: () => new Date() }));
vi.mock("@/components/feed-timer", () => import("../components/feed-timer"));
import Today from "../app/(tabs)/index";

const start = new Date("2026-10-20T03:00:00.000Z");
let renderer: ReactTestRenderer | undefined;
function setup() {
  const account = {
    records: [] as BabyRecord[],
    state: { ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false,
      children: [{ id: "baby", name: "Mia", revision: 1 }],
      profile: { display_name: "Kami Shimizu", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { account.state = change(account.state); }),
    queue: vi.fn(async (m: Mutation) => { account.state = { ...account.state, outbox: [...account.state.outbox, m] }; }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = account;
  return account;
}
const find = (type: string, match: (props: Record<string, unknown>) => boolean) =>
  renderer!.root.findAll((node) => String(node.type) === type && match(node.props));
async function render() {
  await act(async () => {
    if (renderer) renderer.update(React.createElement(Today));
    else renderer = TestRenderer.create(React.createElement(Today));
  });
}
async function tapFeedTile(label = "Feed") {
  const tile = find("Pressable", (p) => p.accessibilityLabel === label)[0];
  expect(tile, label).toBeDefined();
  await act(async () => (tile.props.onPress as () => void)());
  await render();
}
async function press(title: string) {
  const button = find("Button", (p) => p.title === title)[0];
  expect(button, title).toBeDefined();
  await act(async () => { (button.props.onPress as () => void)(); });
  await render();
}
async function pick(index: number) {
  await act(async () => scope.sheets[scope.sheets.length - 1].pick(index));
  await render();
}
const elapsed = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const clock = () => find("Text", () => true).map((node) => node.props.children).find((text) => /^\d/.test(String(text)));

beforeEach(() => {
  vi.useFakeTimers({ now: start });
  vi.clearAllMocks();
  scope.sheets = []; scope.alerts = []; scope.care = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

it("offers the suggested side first, times a switched feed, and saves it with Undo", async () => {
  const account = setup();
  scope.care = [optimisticRecord({ id: "last", kind: "feeding", child_id: "baby", title: "Feeding", body: "",
    occurred_at: "2026-10-20T00:00:00.000Z", data: { method: "breast", side: "left" } })];
  await render();
  await tapFeedTile();
  expect(scope.sheets[0].options).toEqual(["Start right side (next)", "Start left side", "Log a bottle or past feed…", "Cancel"]);
  await pick(0);
  expect(account.state.feedTimer).toMatchObject({ child_id: "baby", generation: 2, started_at: start.toISOString() });
  expect(find("Pressable", (p) => p.accessibilityLabel === "Feeding…")).toHaveLength(1);

  await elapsed(5 * 60_000);
  expect(clock()).toBe("05:00");
  expect(find("View", (p) => p.accessible === true)[0].props.accessibilityLabel).toBe("Feeding Mia. Right side, 5 minutes");
  await press("Switch to left");
  await elapsed(2 * 60_000);
  await press("Pause");
  await elapsed(30 * 60_000);
  await press("Resume");
  await elapsed(60_000);
  await press("Done");

  expect(account.state.feedTimer).toBeUndefined();
  expect(account.state.outbox).toHaveLength(1);
  const saved = account.state.outbox[0] as Extract<Mutation, { type: "save" }>;
  expect(saved.record).toMatchObject({ kind: "feeding", child_id: "baby", occurred_at: start.toISOString(),
    data: { method: "breast", side: "both", duration_minutes: 8 } });
  expect(scope.haptic).toHaveBeenCalledWith("success");
  const [message, action] = scope.toast.mock.calls[scope.toast.mock.calls.length - 1];
  expect(message).toBe("Breastfeeding · Both sides · 8 min · logged");
  expect(find("Button", (p) => p.title === "Done")).toHaveLength(0);

  await act(async () => action.onPress());
  expect(account.state.outbox.map((m) => m.type)).toEqual(["save", "delete"]);
  expect(account.state.feedTimer).toBeUndefined();
});

it("discards a timer only after confirming, and keeps one timer at a time", async () => {
  const account = setup();
  await render();
  await tapFeedTile();
  expect(scope.sheets[0].options.slice(0, 2)).toEqual(["Start left side", "Start right side"]);
  await pick(0);
  await tapFeedTile("Feeding…");
  expect(scope.sheets).toHaveLength(1);
  expect(scope.toast).toHaveBeenCalledWith(expect.stringContaining("timer is running"));

  await press("Cancel timer");
  expect(account.state.feedTimer).toBeDefined();
  const confirm = scope.alerts.find((alert) => alert.title === "Discard this feeding timer?")!;
  await act(async () => confirm.buttons.find((b) => b.text === "Keep timing")?.onPress?.());
  expect(account.state.feedTimer).toBeDefined();
  await act(async () => confirm.buttons.find((b) => b.text === "Discard")!.onPress!());
  await render();
  expect(account.state.feedTimer).toBeUndefined();
  expect(account.state.outbox).toEqual([]);
  expect(find("Button", (p) => p.title === "Done")).toHaveLength(0);
});

it("restores a persisted timer after restart and hides one from an older space", async () => {
  const account = setup();
  account.state = { ...account.state, feedTimer: { child_id: "baby", generation: 2, started_at: start.toISOString(),
    segments: [{ side: "left", started_at: start.toISOString(), ended_at: new Date(start.getTime() + 4 * 60_000).toISOString() }],
    paused_at: new Date(start.getTime() + 4 * 60_000).toISOString() } };
  vi.setSystemTime(start.getTime() + 60 * 60_000);
  await render();
  expect(clock()).toBe("04:00");
  expect(find("Button", (p) => p.title === "Resume")).toHaveLength(1);

  account.state = { ...account.state, bootstrap: { ...account.state.bootstrap!, generation: 3 } };
  await render();
  expect(find("Button", (p) => p.title === "Done")).toHaveLength(0);
  expect(find("Pressable", (p) => p.accessibilityLabel === "Feed")).toHaveLength(1);
});

it("opens the full form for a bottle or past feed", async () => {
  setup();
  await render();
  await tapFeedTile();
  await pick(2);
  expect(scope.push).toHaveBeenCalledWith({ pathname: "/edit", params: { kind: "feeding" } });
});

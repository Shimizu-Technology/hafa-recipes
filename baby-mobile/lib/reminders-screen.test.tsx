import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type DeviceState } from "./models";

const scope = vi.hoisted(() => ({ account: null as any, permissions: { granted: false, canAskAgain: true }, alerts: [] as any[], scheduled: [] as any[] }));
vi.mock("react-native", () => ({
  Alert: { alert: (...args: unknown[]) => scope.alerts.push(args) }, AppState: { addEventListener: () => ({ remove() {} }) }, Linking: { openSettings: vi.fn(async () => {}) },
  Platform: { OS: "ios" }, Switch: "Switch", Text: "Text", View: "View", useWindowDimensions: () => ({ fontScale: 1 }),
}));
vi.mock("expo-notifications", () => ({ getPermissionsAsync: async () => scope.permissions, requestPermissionsAsync: async () => ({ granted: true }), setNotificationChannelAsync: vi.fn() }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@/components/ui", () => ({ Chips: "Chips", Copy: "Copy", Grouped: "Grouped", Notice: "Notice", Row: "Row", Screen: "Screen", Section: "Section", fonts: {}, typeScale: {}, useColors: () => ({}) }));
vi.mock("@/components/time-field", () => ({ TimeField: "TimeField" }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/reminder-permission", () => import("./reminder-permission"));
vi.mock("@/lib/reminder-prefs", () => import("./reminder-prefs"));
vi.mock("./reminders", () => ({ requestReminders: vi.fn(async () => {}) }));
import Reminders from "../app/reminders";

let view: ReactTestRenderer;
const off = { enabled: false, break_through: false, hours: null, feed_hours: null, sleep_hours: null };
function account(extra: Partial<DeviceState> = {}, spaces?: unknown) {
  const b: any = {
    state: { ...emptyState(), reminderPrefs: { quiet_hours: null, kinds: { event: off, feed_interval: off } }, ...extra,
      bootstrap: { generation: 1, children: [], ai_available: false, profile: {}, reminders: { push: true }, spaces } } as unknown as DeviceState,
    refreshPrefs: vi.fn(async () => {}), registerPush: vi.fn(async () => true), sync: vi.fn(async () => {}),
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); }),
  };
  scope.account = b;
  return b;
}
const render = async () => { await act(async () => { view = create(<Reminders />); }); };
const rerender = async () => { await act(async () => { view.update(<Reminders />); }); };
const swtch = (name: string) => view.root.findAll((n) => String(n.type) === "Switch").find((n) => n.props.accessibilityLabel === name)!;
const labels = () => view.root.findAll((n) => String(n.type) === "Switch").map((n) => n.props.accessibilityLabel);
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); scope.alerts = []; scope.permissions = { granted: false, canAskAgain: true }; });
afterEach(async () => { await act(async () => view.unmount()); vi.unstubAllGlobals(); });

describe("Reminders", () => {
  it("opening it asks the phone for nothing", async () => {
    account();
    await render();
    expect(scope.alerts).toEqual([]);
  });
  it("with the flag off there's nothing to turn on", async () => {
    const b = account();
    b.state.bootstrap.reminders = undefined;
    await render();
    expect(labels()).toEqual([]);
    expect(view.root.findAll((n) => String(n.type) === "Notice")).toHaveLength(1);
  });
  it("turning one on says why first, and Not now leaves it off", async () => {
    const b = account();
    await render();
    await act(async () => { swtch("Event reminders").props.onValueChange(true); });
    expect(scope.alerts).toHaveLength(1);
    expect(scope.alerts[0][1]).toMatch(/calendar/);
    await act(async () => { scope.alerts[0][2][0].onPress(); });
    expect(b.state.outbox).toEqual([]);
  });
  it("Continue asks the phone, saves it, and registers", async () => {
    const b = account();
    await render();
    await act(async () => { swtch("Event reminders").props.onValueChange(true); });
    await act(async () => { scope.alerts[0][2][1].onPress(); });
    expect((b.state.outbox[0] as any).patch).toEqual({ kinds: { event: { enabled: true } } });
    expect(b.registerPush).toHaveBeenCalled();
  });
  it("the feed reminder has no default: it's on only once she's chosen the hours", async () => {
    const b = account();
    scope.permissions = { granted: true, canAskAgain: true };
    await render();
    await act(async () => { swtch("Feed reminder").props.onValueChange(true); });
    expect(b.state.outbox).toEqual([]);
    const chips = view.root.findAll((n) => String(n.type) === "Chips")[0];
    expect(chips.props.value).toBe("");
    await act(async () => { chips.props.onChange("2.5"); });
    expect((b.state.outbox[0] as any).patch).toEqual({ kinds: { feed_interval: { hours: 2.5, enabled: true } } });
  });
  it("a caregiver only sees what can reach them", async () => {
    account({}, [{ id: "f", kind: "family", role: "caregiver", generation: 1, access_version: 1 }]);
    await render();
    expect(labels()).toEqual(["Event reminders", "Running timers", "Quiet hours"]);
  });
  it("says so when the phone has them turned off, and offers the way back", async () => {
    account({ reminderPrefs: { quiet_hours: null, kinds: { event: { ...off, enabled: true } } } });
    scope.permissions = { granted: false, canAskAgain: false };
    await render();
    await rerender();
    expect(view.root.findAll((n) => String(n.type) === "Notice")).toHaveLength(1);
    expect(view.root.findAll((n) => String(n.type) === "Row").map((n) => n.props.title)).toContain("Open notification settings");
  });
});

describe("with the flag off", () => {
  it("opening it asks the API for nothing", async () => {
    const b = account();
    b.state.bootstrap.reminders = undefined;
    await render();
    expect(b.refreshPrefs).not.toHaveBeenCalled();
  });
});

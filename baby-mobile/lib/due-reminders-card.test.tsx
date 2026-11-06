import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type DeviceState, type DueReminder } from "./models";

const scope = vi.hoisted(() => ({ account: null as any, navigate: vi.fn(), toast: vi.fn() }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-router", () => ({ router: { navigate: scope.navigate }, usePathname: () => "/" }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/notification-route", () => import("./notification-route"));
vi.mock("@/lib/reminder-due", () => import("./reminder-due"));
vi.mock("@/lib/reminder-open", () => import("./reminder-open"));
vi.mock("../components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", PressTarget: "PressTarget", useToast: () => scope.toast }));
import { DueReminders } from "../components/due-reminders";

const id = "378b714d-a2b5-444a-a3bc-c7c9ec7708bd";
const due = (n: string, extra: Partial<DueReminder> = {}): DueReminder => ({ id: n, kind: "event", text: `Reminder ${n}`, due_at: "2026-11-06T00:00:00Z", delivery: "accepted", identity: n, data: { event_id: id }, ...extra });
let view: ReactTestRenderer;
function setup(items: DueReminder[], reminders: { push?: boolean } | undefined = { push: true }) {
  const b: any = {
    state: { ...emptyState(), dueReminders: items, bootstrap: { generation: 1, children: [{ id: "baby" }], reminders } } as unknown as DeviceState,
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); }), sync: vi.fn(async () => {}), refresh: vi.fn(),
  };
  scope.account = b;
  return b;
}
const render = async () => { await act(async () => { view = create(<DueReminders />); }); };
const buttons = () => view.root.findAll((n) => String(n.type) === "Button");
const presses = () => view.root.findAll((n) => String(n.type) === "PressTarget");
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); scope.navigate.mockClear(); scope.toast.mockClear(); });
afterEach(async () => { await act(async () => view.unmount()); vi.unstubAllGlobals(); });

it("shows nothing at all with the flag off", async () => {
  setup([due("a")], {});
  await render();
  expect(view.toJSON()).toBeNull();
});
it("each has a way to dismiss it, and it goes at once", async () => {
  const b = setup([due("a"), due("b")]);
  await render();
  expect(buttons().map((n) => n.props.accessibilityLabel)).toEqual(["Dismiss: Reminder a", "Dismiss: Reminder b"]);
  await act(async () => { buttons()[0].props.onPress(); });
  expect(b.state.dismissing).toEqual(["a"]);
  await act(async () => { view.update(<DueReminders />); });
  expect(buttons()).toHaveLength(1);
});
it("tapping one opens where it lives", async () => {
  setup([due("a", { space_id: "s" })]);
  await render();
  await act(async () => { presses()[0].props.onPress(); });
  expect(scope.navigate).toHaveBeenCalledWith({ pathname: "/event/[id]", params: { id } });
});
it("one with nowhere to open says so, plainly", async () => {
  setup([due("a", { kind: "unknown" })]);
  await render();
  await act(async () => { presses()[0].props.onPress(); });
  expect(scope.navigate).not.toHaveBeenCalled();
  expect(scope.toast).toHaveBeenCalledWith("That reminder isn’t here any more.");
});
it("a long list stays short until she asks", async () => {
  setup(["a", "b", "c", "d", "e"].map((n) => due(n)));
  await render();
  expect(buttons()).toHaveLength(3);
  await act(async () => { presses()[3].props.onPress(); });
  expect(buttons()).toHaveLength(5);
});

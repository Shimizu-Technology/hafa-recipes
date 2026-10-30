import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { initialProfile } from "./models";

const f = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("expo-router", () => ({ router: { push: f.push } }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ units: "metric", setUnits: vi.fn() }) }));
vi.mock("@/components/ui", () => ({ Button: "Button", Chip: "Chip", ChipRow: "ChipRow", Choice: "Choice", Copy: "Copy", Field: "Field" }));
vi.mock("@/components/activity-context", () => ({ ActivityContext: "ActivityContext" }));
vi.mock("@/components/optional-number", () => ({ OptionalNumber: "OptionalNumber" }));
vi.mock("@/components/calendar-date", () => ({ CalendarDate: "CalendarDate" }));
vi.mock("@/components/equipment-locations", () => ({ EquipmentLocations: "EquipmentLocations" }));
vi.mock("@/components/recorded-time", () => ({ RecordedTime: "RecordedTime" }));
import { ProfileForm } from "../components/profile-form";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; f.push.mockReset(); });
const profile = { ...initialProfile(), adult_confirmed: true, readiness: "limited" as const };
async function mount(saved: boolean, transient = false) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => { renderer = create(createElement(ProfileForm, {
    value: profile, baseline: saved ? profile : null, update: vi.fn(), disabled: true,
    checkInDisabled: transient, expandDetails: true
  })); });
  return renderer!.root.findAllByType("Button" as never).find(n => n.props.title === "Check in for today")!;
}
it("navigates from a sealed saved profile to today's live check-in without changing legacy readiness", async () => {
  const button = await mount(true);
  expect(button.props.disabled).toBe(false);
  await act(async () => button.props.onPress());
  expect(f.push).toHaveBeenCalledWith({ pathname: "/coach", params: { check_in: "today" } });
  expect(profile.readiness).toBe("limited");
});
it("explains why a first unsaved profile must be saved before checking in", async () => {
  expect((await mount(false)).props.disabled).toBe(true);
  expect(renderer!.root.findAllByType("Copy" as never).some(n => n.children.join("").includes("Save your profile first"))).toBe(true);
});
it("blocks check-in navigation while profile saving or recovery is in progress", async () => {
  expect((await mount(true, true)).props.disabled).toBe(true);
});

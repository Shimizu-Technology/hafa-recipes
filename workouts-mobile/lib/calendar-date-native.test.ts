import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ os: "ios" }));
vi.mock("react-native", () => ({ Platform: { get OS() { return f.os; } } }));
vi.mock("@expo/ui/community/datetime-picker", () => ({ DateTimePicker: "DateTimePicker" }));
vi.mock("../components/ui", () => ({ Button: "Button", ButtonRow: "ButtonRow", Copy: "Copy" }));
vi.mock("../components/design/foundation", () => ({ useColors: () => ({ action: "blue" }) }));
import { CalendarDate } from "../components/calendar-date.native";

let view: ReactTestRenderer | undefined;
const props = { label: "Class date", onChange: vi.fn() };
const mount = (extra: object = {}) => act(() => { view = create(createElement(CalendarDate, { ...props, ...extra } as never)); });
const button = (title: string) => view!.root.findAllByType("Button" as never).find(node => node.props.title === title);
const picker = () => view!.root.findAllByType("DateTimePicker" as never)[0];
const words = () => view!.root.findAllByType("Copy" as never).map(node => [node.props.children].flat().join(""));
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; props.onChange.mockClear(); f.os = "ios"; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 17, 9)); });
afterEach(() => { act(() => view?.unmount()); vi.useRealTimers(); });

it("shows a chosen day as a readable date and hands the picker the same day", () => {
  mount({ value: "2026-11-18" });
  expect(words()).toContain("Wed, Nov 18");
  act(() => button("Change date")!.props.onPress());
  const date = picker().props.value as Date;
  expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 10, 18]);
});
it("stores a picked day in the same YYYY-MM-DD format", () => {
  mount({ value: "2026-11-18" });
  act(() => button("Change date")!.props.onPress());
  act(() => picker().props.onValueChange({}, new Date(2026, 11, 3, 12)));
  expect(props.onChange).toHaveBeenLastCalledWith("2026-12-03");
});
it("opens an empty date on today, so Done never leaves it blank", () => {
  mount({ value: null });
  expect(words()).toContain("Not specified");
  act(() => button("Choose date")!.props.onPress());
  expect(props.onChange).toHaveBeenCalledWith("2026-11-17");
  expect(picker()).toBeDefined();
});
it("has a one-tap Use today when the date is empty", () => {
  mount({ value: undefined, optional: true });
  act(() => button("Use today")!.props.onPress());
  expect(props.onChange).toHaveBeenCalledWith("2026-11-17");
});
it("clears an optional date, and offers no Clear for a required one", () => {
  mount({ value: "2026-11-18", optional: true });
  expect(words()).toContain("Class date · optional");
  act(() => button("Clear")!.props.onPress());
  expect(props.onChange).toHaveBeenCalledWith(null);
  act(() => view!.unmount());
  mount({ value: "2026-11-18" });
  expect(button("Clear")).toBeUndefined();
});
it("never opens a picker earlier than the minimum day", () => {
  mount({ value: null, min: "2026-12-01" });
  act(() => button("Choose date")!.props.onPress());
  expect(props.onChange).toHaveBeenCalledWith("2026-12-01");
});
it("keeps every button's spoken name specific to the field", () => {
  mount({ value: "2026-11-18", optional: true });
  expect(button("Change date")!.props.accessibilityLabel).toBe("Change class date");
  expect(button("Clear")!.props.accessibilityLabel).toBe("Clear class date");
});
it("is disabled as a whole", () => {
  mount({ value: "2026-11-18", optional: true, disabled: true });
  expect([button("Change date"), button("Clear")].map(node => node!.props.disabled)).toEqual([true, true]);
});

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDay } from "./tracker";

const os = vi.hoisted(() => ({ OS: "ios" }));
vi.mock("react-native", () => ({ Modal: "Modal", Platform: os, View: "View", useColorScheme: () => "light" }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: "DateTimePicker" }));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("../components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", useColors: () => ({}) }));
import { DateField } from "../components/date-field";

describe("a new day keeps the time she chose", () => {
  it("on the family's clock, whatever time the picker hands back", () => {
    const born = new Date("2026-12-08T13:40:00.000Z"); // 11:40 PM, Dec 8, in Guam.
    // iOS's date spinner hands back the picked day at midnight on its clock.
    expect(withDay(new Date("2026-12-05T14:00:00.000Z"), born, "Pacific/Guam").toISOString()).toBe("2026-12-06T13:40:00.000Z"); // Dec 6, 12:00 AM.
    // Or at whatever time it kept: still the day picked, at 11:40 PM.
    expect(withDay(new Date("2026-12-07T02:15:00.000Z"), born, "Pacific/Guam").toISOString()).toBe("2026-12-07T13:40:00.000Z"); // Dec 7, 12:15 PM.
  });
  it("across a clock change, as that day's clock reads it", () => {
    const evening = new Date("2026-03-07T02:30:00.000Z"); // 6:30 PM PST, Mar 6.
    expect(withDay(new Date("2026-03-09T08:00:00.000Z"), evening, "America/Los_Angeles").toISOString()).toBe("2026-03-10T01:30:00.000Z"); // 6:30 PM PDT.
  });
});

describe("DateField", () => {
  let view: ReactTestRenderer | undefined;
  const all = (type: string) => view!.root.findAll((n) => String(n.type) === type);
  const button = (title: string) => all("Button").find((n) => n.props.title === title)!;
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); os.OS = "ios"; });
  afterEach(async () => { await act(async () => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });
  const mount = async (props: { onChange: (iso: string) => void; maximumDate?: Date; value?: string; dateOnly?: boolean; timeZone?: string }) => {
    await act(async () => { view = create(<DateField label="Day and time" value="2026-12-08T13:40:00.000Z" timeZone="Pacific/Guam" {...props} />); });
  };
  it("changing the day on iOS keeps 11:40 PM", async () => {
    const onChange = vi.fn();
    await mount({ onChange });
    await act(async () => { all("Button")[0].props.onPress(); });
    await act(async () => { all("DateTimePicker")[0].props.onChange({ type: "set" }, new Date("2026-12-05T14:00:00.000Z")); });
    await act(async () => { button("Use this date").props.onPress(); });
    expect(onChange).toHaveBeenCalledWith("2026-12-06T13:40:00.000Z");
  });
  it("changing the day on Android keeps it too", async () => {
    os.OS = "android";
    const onChange = vi.fn();
    await mount({ onChange });
    await act(async () => { all("Button")[0].props.onPress(); });
    await act(async () => { all("DateTimePicker")[0].props.onChange({ type: "set" }, new Date("2026-12-05T14:00:00.000Z")); });
    expect(onChange).toHaveBeenCalledWith("2026-12-06T13:40:00.000Z");
  });
  it("changing the time keeps the day, and nothing passes the latest allowed", async () => {
    const onChange = vi.fn(), latest = new Date("2026-12-08T05:00:00.000Z"); // Dec 8, 3 PM in Guam.
    await mount({ onChange, maximumDate: latest, value: "2026-12-07T13:40:00.000Z" });
    await act(async () => { all("Button")[1].props.onPress(); });
    await act(async () => { all("DateTimePicker")[0].props.onChange({ type: "set" }, new Date("2026-12-07T01:05:00.000Z")); });
    await act(async () => { button("Use this time").props.onPress(); });
    expect(onChange).toHaveBeenLastCalledWith("2026-12-07T01:05:00.000Z");
    // Yesterday 11:40 PM moved to today would be later than now: it stops at now.
    await mount({ onChange, maximumDate: latest, value: "2026-12-07T13:40:00.000Z" });
    await act(async () => { all("Button")[0].props.onPress(); });
    await act(async () => { all("DateTimePicker")[0].props.onChange({ type: "set" }, new Date("2026-12-07T14:00:00.000Z")); });
    await act(async () => { button("Use this date").props.onPress(); });
    expect(onChange).toHaveBeenLastCalledWith(latest.toISOString());
  });
  it("a date-only field still gives just the day", async () => {
    const onChange = vi.fn();
    await mount({ onChange, dateOnly: true, value: "2026-12-08", timeZone: undefined });
    await act(async () => { all("Button")[0].props.onPress(); });
    await act(async () => { all("DateTimePicker")[0].props.onChange({ type: "set" }, new Date(2026, 11, 6, 15, 0)); });
    await act(async () => { button("Use this date").props.onPress(); });
    expect(onChange).toHaveBeenCalledWith("2026-12-06");
  });
});

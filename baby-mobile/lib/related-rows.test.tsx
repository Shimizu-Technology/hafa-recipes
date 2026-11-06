import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { optimisticRecord, type BabyRecord } from "./models";

const m = vi.hoisted(() => ({ baby: null as any, push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-router", () => ({ router: { push: m.push } }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.baby }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("../components/ui", () => ({ Row: "Row", Grouped: "Grouped", Section: "Section" }));
vi.mock("../components/visit-sections", () => ({ RecordVisit: "RecordVisit" }));
import { RelatedRows } from "../components/related-rows";

const now = new Date("2026-11-04T03:00:00.000Z");
const writing = (over: Partial<BabyRecord> = {}) => ({ ...optimisticRecord({ id: "entry", kind: "journal", title: "First night", body: "", child_id: null, occurred_at: "2026-10-26T02:00:00.000Z", data: {} }), ...over }) as BabyRecord;
let renderer: ReactTestRenderer | undefined;
async function mount(record: BabyRecord) { await act(async () => { renderer = create(<RelatedRows record={record} />); }); }
const rows = () => renderer!.root.findAll((n) => String(n.type) === "Row").map((n) => n.props);
const row = (start: string) => rows().find((props) => props.title.startsWith(start))!;

beforeEach(() => {
  vi.useFakeTimers({ now });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  m.push.mockClear();
  m.baby = { state: { selectedChild: null, bootstrap: { profile: { timezone: "Pacific/Guam" }, personal_space_id: "me",
    children: [{ id: "mia", name: "Mia", birth_date: "2026-10-25", space_id: "fam" }, { id: "noa", name: "Noa", birth_date: "2024-01-01", space_id: "fam" }] } } };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("names its day and its baby in words, and keeps its visit with them", async () => {
  await mount(writing({ child_id: "mia" }));
  expect(rows().map((props) => [props.title, props.detail])).toEqual([["On October 26", "Open this day"], ["For Mia", "Baby profile"]]);
  expect(renderer!.root.findAll((n) => String(n.type) === "RecordVisit")).toHaveLength(1);
});
it("carries its own baby and day to Tracker with a fresh token, leaving the selected baby alone", async () => {
  m.baby.state.selectedChild = "noa";
  await mount(writing({ child_id: "mia" }));
  await act(async () => row("On").onPress());
  expect(m.push).toHaveBeenCalledWith({ pathname: "/day", params: { day: "2026-10-26", child: "mia", at: String(now.getTime()) } });
  expect(m.baby.state.selectedChild).toBe("noa");
});
it("opens a baby's profile on top, so Back returns to the entry", async () => {
  await mount(writing({ child_id: "noa" }));
  await act(async () => row("For").onPress());
  expect(m.push).toHaveBeenCalledWith({ pathname: "/child", params: { id: "noa" } });
});
it("opens writing for nobody in particular on the baby Tracker would show, with no baby row of its own", async () => {
  m.baby.state.selectedChild = "noa";
  await mount(writing());
  expect(rows().map((props) => props.title)).toEqual(["On October 26"]);
  await act(async () => row("On").onPress());
  expect(m.push.mock.calls[0][0].params.child).toBe("noa");
});
it("names no baby this account can't read", async () => {
  await mount(writing({ child_id: "someone-else" }));
  expect(rows().map((props) => props.title)).toEqual(["On October 26"]);
});
it("works with no baby set up at all", async () => {
  m.baby.state.bootstrap.children = [];
  await mount(writing());
  await act(async () => row("On").onPress());
  expect(m.push.mock.calls[0][0].params).toEqual({ day: "2026-10-26", child: undefined, at: expect.any(String) });
});
it("uses the day Tracker files it under, on the family's clock, whatever the phone's zone", async () => {
  m.baby.state.bootstrap.profile.timezone = "Pacific/Kiritimati";
  // 11:30 PM on the 26th in Guam is already the 27th at +14.
  await mount(writing({ occurred_at: "2026-10-26T13:30:00.000Z" }));
  expect(rows()[0].title).toBe("On October 27");
  await act(async () => rows()[0].onPress());
  expect(m.push.mock.calls[0][0].params.day).toBe("2026-10-27");
});
it("says the year once it isn't this one", async () => {
  await mount(writing({ occurred_at: "2025-12-31T02:00:00.000Z" }));
  expect(rows()[0].title).toBe("On December 31, 2025");
});
it("draws nothing from anywhere but the row: no counts, no other writing, whoever is reading", async () => {
  m.baby.records = [writing({ id: "their-private", title: "Their secret", child_id: "mia" })];
  await mount(writing({ child_id: "mia", space_id: "fam", created_by: "other" }));
  expect(JSON.stringify(rows().map(({ title, detail }) => [title, detail]))).not.toMatch(/secret|\d+ (entries|notes)/i);
});

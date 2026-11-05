import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BabyRecord } from "./models";

const m = vi.hoisted(() => ({ children: [] as unknown[] }));
vi.mock("react-native", () => ({ View: "View", Text: "Text" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { bootstrap: { children: m.children, profile: { timezone: "Pacific/Guam" } } } }) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("../components/ui", () => ({ Row: "Row", fonts: {}, useColors: () => ({}) }));
vi.mock("../components/saved-post-row", () => ({ SavedPostRow: "SavedPostRow" }));
import { RecordRow } from "../components/record-row";

const row = (kind: BabyRecord["kind"], data: Record<string, unknown>, title: string, body = "", child: string | null = "baby") =>
  ({ id: "x", kind, title, body, child_id: child, occurred_at: "2026-11-04T04:14:00.000Z", data, revision: 1, created_at: "", updated_at: "" }) as BabyRecord;
const now = new Date("2026-11-04T06:14:00.000Z");
let renderer: ReactTestRenderer | undefined;
async function shown(record: BabyRecord) {
  await act(async () => { renderer = create(<RecordRow record={record} now={now} />); });
  return renderer!.root.findByType("Row" as never).props as { title: string; detail: string };
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.children = [{ id: "baby", name: "Mia" }]; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("2: reads a log on the family's clock, as Tracker and its Last do", async () => {
  expect((await shown(row("medicine", { name: "Tylenol" }, "Tylenol"))).detail).toBe("2:14 PM");
});
it("6: shows the reading and the note, and never says Entry", async () => {
  expect(await shown(row("custom", { label: "Blood pressure" }, "118/76", "left arm", null))).toEqual(expect.objectContaining({ title: "Blood pressure", detail: "118/76 · left arm · 2:14 PM · For you" }));
  await act(async () => renderer!.unmount());
  expect(await shown(row("custom", { label: "Note" }, "Note", "Spit up"))).toEqual(expect.objectContaining({ title: "Note", detail: "Spit up · 2:14 PM" }));
  await act(async () => renderer!.unmount());
  expect((await shown(row("custom", { label: "Vitamins and medicine" }, "Prenatal", "", null))).detail).toBe("Prenatal · 2:14 PM · For you");
});
it("7: shows a shot by its name, on its date, with no storage noon", async () => {
  const seen = await shown(row("custom", { label: "Shot" }, "Hep B"));
  expect(seen.title).toBe("Hep B");
  expect(seen.detail).toContain("Shot");
  expect(seen.detail).toContain("November 4, 2026");
  expect(seen.detail).not.toMatch(/AM|PM|Entry/);
});
it("13: says when a log's baby was removed", async () => {
  expect((await shown(row("medicine", { name: "Tylenol" }, "Tylenol", "", null))).detail).toBe("2:14 PM · From a removed profile");
});
it("lists kicks and contractions by what they were", async () => {
  const seen = await shown(row("kick_session", { count: 10, end_at: "2026-11-04T04:30:00.000Z" }, "Kick count"));
  expect(seen.title).toBe("Kick count");
  expect(seen.detail).toContain("10");
});

it("keeps a custom entry's own title beside its numbers", async () => {
  expect(await shown(row("custom", { label: "Bath", value: 2, unit: "min" }, "First bath with Dad"))).toEqual(expect.objectContaining({ title: "Bath · 2 min", detail: "First bath with Dad · 2:14 PM" }));
});

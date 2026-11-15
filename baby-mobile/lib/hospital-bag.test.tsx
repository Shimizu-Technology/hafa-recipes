import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { added, bagSections, findBag, grouped, isBag, packedLine, removed, sectionOf, starterBag, starterItems, toggled } from "./hospital-bag";
import type { BabyRecord } from "./models";

const m = vi.hoisted(() => ({ baby: null as any, toast: vi.fn() }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${++n.count}` }));
const n = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.baby }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", HeaderAction: "HeaderAction",
  Icon: "Icon", Notice: "Notice", PressTarget: "PressTarget", Screen: "Screen", Section: "Section", tap: vi.fn(), useColors: () => ({}), useToast: () => m.toast }));
import HospitalBag from "../app/hospital-bag";

const bag = (over: Partial<BabyRecord> = {}): BabyRecord => ({ id: "bag", kind: "routine", title: "Hospital bag", body: "", child_id: null,
  occurred_at: "2026-11-15T00:00:00.000Z", revision: 2, created_at: "", updated_at: "2026-11-15T01:00:00.000Z",
  data: { routine_type: "checklist", items: starterItems(), enabled: false, repeat: "none" }, ...over } as BabyRecord);

describe("the list", () => {
  it("starts with every section, nothing ticked, with ids the API accepts", () => {
    const items = starterItems();
    expect(items.length).toBe(Object.values(starterBag).flat().length);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.every((item) => !item.done && item.id.length <= 80 && item.label.length <= 500)).toBe(true);
    expect(grouped(bag()).map((section) => section.title)).toEqual(bagSections.map((section) => section.title));
    expect(items.find((item) => item.id === "bag:baby:car-seat")?.label).toBe("Rear-facing car seat, installed before the day");
  });
  it("is found among her lists, newest first, and nothing else is", () => {
    const other = { ...bag({ id: "evening", title: "Evening routine" }), data: { routine_type: "checklist", items: [{ id: "x", label: "Bath", done: false }] } } as BabyRecord;
    expect(isBag(other)).toBe(false);
    expect(findBag([other, bag({ id: "old", updated_at: "2026-11-01" }), bag({ id: "new" })])?.id).toBe("new");
    expect(findBag([other])).toBeUndefined();
  });
  it("counts, ticks, adds in its section and removes", () => {
    let row = bag();
    expect(packedLine(row)).toBe(`0 of ${starterItems().length} packed`);
    row = { ...row, data: toggled(row, "bag:mom:robe") };
    expect(packedLine(row)).toBe(`1 of ${starterItems().length} packed`);
    row = { ...row, data: added(row, "baby", "  Pacifier  ", "k1") };
    const baby = grouped(row).find((section) => section.id === "baby")!.items;
    expect(baby.at(-1)).toEqual({ id: "bag:baby:k1", label: "Pacifier", done: false });
    row = { ...row, data: removed(row, "bag:baby:k1") };
    expect(row.data.items!.some((item) => item.id === "bag:baby:k1")).toBe(false);
    expect(packedLine({ ...row, data: { ...row.data, items: [{ id: "bag:mom:a", label: "A", done: true }] } })).toBe("All 1 packed");
  });
  it("stays the bag with every starter line removed, and nothing else titled otherwise is", () => {
    expect(isBag(bag({ data: { ...bag().data, items: [] } }))).toBe(true);
    expect(isBag(bag({ title: "Evening", data: { ...bag().data, items: [] } }))).toBe(false);
  });
  it("keeps a line added in the routine editor, under Also packing", () => {
    expect(sectionOf("4f0c-uuid")).toBe("other");
    expect(sectionOf("bag:nope:x")).toBe("other");
    const row = bag({ data: { ...bag().data, items: [...starterItems(), { id: "plain", label: "Snacks for nurses", done: false }] } });
    expect(grouped(row).at(-1)).toMatchObject({ title: "Also packing", items: [{ label: "Snacks for nurses" }] });
  });
});

describe("the screen", () => {
  let renderer: ReactTestRenderer | undefined;
  const all = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
  const button = (title: string) => all("Button").find((node) => node.props.title === title)!;
  const setup = (records: BabyRecord[], spaces: unknown[] = []) => {
    m.baby = { records, state: { bootstrap: { generation: 3, spaces } }, queue: vi.fn(async () => undefined) };
  };
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.toast.mockClear(); });
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
  const mount = async () => { await act(async () => { renderer = create(<HospitalBag />); }); };

  it("starts the starter list in one tap, as an ordinary checklist with no reminder", async () => {
    setup([]);
    await mount();
    await act(async () => { await button("Start my hospital bag").props.onPress(); });
    const change = m.baby.queue.mock.calls[0][0];
    expect(change).toMatchObject({ type: "save", generation: 3, files: [],
      record: { kind: "routine", title: "Hospital bag", child_id: null, data: { routine_type: "checklist", enabled: false, repeat: "none" } } });
    expect(change.record.data.items).toHaveLength(starterItems().length);
  });
  it("ticks an item off with one tap, and says who sees it", async () => {
    setup([bag()], [{ id: "f", kind: "family", role: "parent" }]);
    await mount();
    expect(all("Screen")[0].props.subtitle).toBe(`0 of ${starterItems().length} packed · shared with your family`);
    await act(async () => { all("Choice")[0].props.onPress(); });
    const saved = m.baby.queue.mock.calls[0][0].record;
    expect(saved).toMatchObject({ id: "bag", revision: 2 });
    expect(saved.data.items[0]).toMatchObject({ id: "bag:mom:robe", done: true });
    // The sync line comes and goes as she ticks; under the list it never moves the next row from under her thumb.
    const order = renderer!.root.findAll((node) => ["Choice", "SyncStatus"].includes(String(node.type))).map((node) => String(node.type));
    expect(order.at(-1)).toBe("SyncStatus");
  });
  it("in Edit, adds to a section and removes with Undo", async () => {
    setup([bag()]);
    await mount();
    await act(async () => { all("Screen")[0].props.action.props.onPress(); });
    const field = all("Field").find((node) => node.props.label === "Add something for baby")!;
    await act(async () => { field.props.onChange("Pacifier"); });
    await act(async () => { all("Button").filter((node) => node.props.title === "Add")[1].props.onPress(); });
    expect(m.baby.queue.mock.calls[0][0].record.data.items.some((item: { label: string }) => item.label === "Pacifier")).toBe(true);
    const removeRobe = all("PressTarget").find((node) => node.props.accessibilityLabel === "Remove Robe or loose, comfortable clothes")!;
    await act(async () => { removeRobe.props.onPress(); });
    expect(m.baby.queue.mock.calls[1][0].record.data.items.some((item: { id: string }) => item.id === "bag:mom:robe")).toBe(false);
    expect(m.toast.mock.calls[0][0]).toBe("Removed Robe or loose, comfortable clothes");
    // A second bag, newer, from the other phone: Undo still goes back into this one.
    m.baby.records = [bag({ id: "other", updated_at: "2026-11-16T00:00:00.000Z" }), { ...bag(), data: m.baby.queue.mock.calls[1][0].record.data }];
    await act(async () => { m.toast.mock.calls[0][1].onPress(); });
    expect(m.baby.queue.mock.calls[2][0].record).toMatchObject({ id: "bag" });
    expect(m.baby.queue.mock.calls[2][0].record.data.items[0]).toMatchObject({ id: "bag:mom:robe" });
  });
});

import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ font: 1, push: vi.fn() }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", useWindowDimensions: () => ({ fontScale: mock.font }) }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mock.push(...args) } }));
vi.mock("@/lib/source-title", () => import("./source-title"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("../components/ui", () => ({ Copy: "Copy", Grouped: "Grouped", Icon: "Icon", PressTarget: "Pressable", fonts: {}, radii: {}, typeScale: {}, useColors: () => ({}) }));
import { NowShelf, SavedSections } from "../components/saved-sections";
import { nowShelfTitle, savedSections, takeaway } from "./saved-sections";
import type { BabyRecord } from "./models";

const post = (id: string, day: number, extra: Partial<BabyRecord> = {}) => ({ id, kind: "source", title: id, body: "", child_id: null, revision: 1,
  occurred_at: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`, created_at: "", updated_at: "", data: { status: "ready" }, ...extra } as BabyRecord);
const category = (id: string, title: string, record_ids: string[]) => ({ ...post(id, 1), kind: "collection", title, data: { record_ids } } as BabyRecord);

describe("savedSections", () => {
  const posts = [post("a", 1), post("b", 5), post("c", 3), post("d", 4), post("e", 2), post("twin", 6, { child_id: "other" })];
  const bag = category("bag", "Hospital bag", ["a", "b", "c", "d", "gone"]), feed = category("feed", "Feeding", ["d"]), empty = category("none", "Sleep", []);
  it("lists each category's newest three with its count, then the posts in none", () => {
    const { sections, unsorted } = savedSections([...posts, bag], [bag, feed, empty], null);
    expect(sections.map((s) => [s.category.title, s.count, s.rows.map((r) => r.id)])).toEqual([
      // The category's own count, including a post not on this phone yet; a post can sit in two categories.
      ["Hospital bag", 5, ["b", "d", "c"]], ["Feeding", 1, ["d"]],
    ]);
    expect(unsorted).toEqual({ count: 2, rows: [posts[5], posts[4]] });
  });
  it("follows the child filter and counts only what it shows", () => {
    const { sections, unsorted } = savedSections(posts, [bag], "kid");
    expect(sections[0].count).toBe(4);
    expect(unsorted.rows.map((r) => r.id)).toEqual(["e"]);
  });
  it("stays quick with hundreds of posts", () => {
    const many = Array.from({ length: 600 }, (_, i) => post(`p${i}`, (i % 28) + 1));
    const cats = Array.from({ length: 12 }, (_, i) => category(`c${i}`, `C${i}`, many.filter((_, j) => j % 12 === i).map((r) => r.id)));
    const started = performance.now();
    const { sections, unsorted } = savedSections(many, cats, null);
    expect(performance.now() - started).toBeLessThan(50);
    expect(sections).toHaveLength(12);
    expect(unsorted.count).toBe(0);
  });
});

it("names the now shelf by week in pregnancy and by Today's age after birth", () => {
  const now = new Date(2026, 10, 17);
  expect(nowShelfTitle({ stage: "pregnancy", value: 37 }, null, now)).toBe("For week 37");
  expect(nowShelfTitle({ stage: "baby", value: 2 }, { birth_date: "2026-11-01" }, now)).toBe("For week 3");
  expect(nowShelfTitle({ stage: "baby", value: 20 }, { birth_date: "2026-06-10" }, now)).toBe("For month 5");
  expect(nowShelfTitle(null, null, now)).toBe("");
});

it("takes the first sentence of a summary", () => {
  expect(takeaway("An L&D nurse packs a small bag. She skips the robe.")).toBe("An L&D nurse packs a small bag.");
  expect(takeaway("Fifteen items, and what she never unpacked")).toBe("Fifteen items, and what she never unpacked");
  expect(takeaway("Use 3.5 oz bottles at first! Then size up.")).toBe("Use 3.5 oz bottles at first!");
  expect(takeaway(undefined)).toBe("");
});

let view: ReturnType<typeof create> | undefined;
async function render(node: React.ReactElement) {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => { view = create(node); });
  return view!;
}
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; mock.font = 1; vi.clearAllMocks(); vi.unstubAllGlobals(); });
const labels = (node: ReturnType<typeof create>) => node.root.findAllByType("Pressable" as React.ElementType).map((n) => n.props.accessibilityLabel);

it("shows the week's posts as square covers, and as rows at the largest text sizes", async () => {
  const onSeeAll = vi.fn(), tip = post("Bag list", 2, { data: { status: "ready", relevance: { pregnancy_week_min: 36 } } });
  const shelf = await render(<NowShelf title="For week 37" rows={[tip]} count={1} pending={() => false} onSeeAll={onSeeAll} />);
  expect(labels(shelf)).toEqual(["For week 37, 1 post. See all", "Bag list. From 36 weeks"]);
  expect(shelf.root.findAllByType("ScrollView" as React.ElementType)).toHaveLength(1);
  await act(async () => shelf.root.findAllByType("Pressable" as React.ElementType)[0].props.onPress());
  expect(onSeeAll).toHaveBeenCalled();
  mock.font = 3.1;
  await act(async () => shelf.update(<NowShelf title="For week 37" rows={[tip]} count={1} pending={() => false} onSeeAll={onSeeAll} />));
  expect(shelf.root.findAllByType("ScrollView" as React.ElementType)).toHaveLength(0);
  expect(shelf.root.findAllByType("Grouped" as React.ElementType)).toHaveLength(1);
  // Nothing for this week: no empty shelf.
  await act(async () => shelf.update(<NowShelf title="For week 37" rows={[]} count={0} pending={() => false} onSeeAll={onSeeAll} />));
  expect(shelf.toJSON()).toBeNull();
});

it("opens a category from its heading, and Not sorted yet from Sort, with the suggestion under its row", async () => {
  const open = vi.fn(), sort = vi.fn(), bag = category("bag", "Hospital bag", ["a"]);
  const sections = await render(<SavedSections sections={[{ category: bag, count: 2, rows: [post("a", 1)] }]}
    unsorted={{ count: 1, rows: [post("loose", 2)] }} pending={() => false} onOpenCategory={open} onSeeUnsorted={sort}
    extra={(record) => <Text>{`Suggested for ${record.id}`}</Text>} />);
  expect(labels(sections)).toEqual(["Hospital bag, 2 posts. See all", "a", "Not sorted yet, 1 post. Sort", "loose"]);
  await act(async () => sections.root.findAllByType("Pressable" as React.ElementType)[0].props.onPress());
  expect(open).toHaveBeenCalledWith("bag");
  await act(async () => sections.root.findAllByType("Pressable" as React.ElementType)[2].props.onPress());
  expect(sort).toHaveBeenCalled();
  expect(JSON.stringify(sections.toJSON())).toContain("Suggested for loose");
});
const Text = "Text" as unknown as React.ComponentType<{ children: React.ReactNode }>;

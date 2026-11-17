import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ font: 1, push: vi.fn(), who: null as string | null }));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Pressable: "Pressable", Text: "Text", View: "View", useWindowDimensions: () => ({ fontScale: mock.font }) }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mock.push(...args) } }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ owner: "me", state: { bootstrap: null } }) }));
vi.mock("@/lib/source-title", () => import("./source-title"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("../components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", Grouped: "Grouped", Icon: "Icon", Notice: "Notice", PressTarget: "Pressable",
  fonts: {}, radii: {}, typeScale: {}, useColors: () => ({}) }));
vi.mock("../components/disclosure", () => ({ Disclosure: "Disclosure" }));
vi.mock("../components/timing-editor", () => ({ TimingEditor: "TimingEditor", TimingRow: "TimingRow" }));
vi.mock("../components/source-recovery", () => ({ SourceRecovery: "SourceRecovery" }));
vi.mock("../components/share-toggle", () => ({ ShareToggle: "ShareToggle", whoCanSee: () => mock.who }));
import { SourceHero } from "../components/saved-post-row";
import { SourceContent, SourceMore } from "../components/source-content";
import type { BabyRecord } from "./models";

const post = (data: BabyRecord["data"] = {}, body = "") => ({ id: "post", kind: "source", title: "Reference charts", body, child_id: null,
  occurred_at: "2026-11-16T01:00:00Z", created_at: "2026-11-16T01:00:00Z", updated_at: "2026-11-16T01:00:00Z", revision: 1,
  data: { status: "ready", url: "https://www.tiktok.com/@newmom/photo/1", creator: "newmom.notes", summary: "Charts for the first weeks.",
    key_points: ["Feeding: 8–12 times a day (slide 2)", "Milk storage times"], relevance: { stage: "baby", baby_age_min_weeks: 0 },
    evidence: [{ location: "caption", text: "charts" }, { location: "image:0", text: "a" }, { location: "image:1", text: "b" }], ...data } } as BabyRecord);
let view: ReturnType<typeof create> | undefined;
async function render(node: React.ReactElement) {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => { view = create(node); });
  return view!;
}
const texts = (node: ReturnType<typeof create>) => JSON.stringify(node.toJSON());
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; mock.font = 1; mock.who = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("leads with timing and category pills, then the title and who posted it where", async () => {
  const hero = await render(<SourceHero record={post()} title="Reference charts" topic="Newborn care" distance="about 3 weeks from now" />);
  const text = texts(hero);
  expect(text.indexOf("From 0 weeks · about 3 weeks from now")).toBeLessThan(text.indexOf("Newborn care"));
  expect(text.indexOf("Newborn care")).toBeLessThan(text.indexOf("Reference charts"));
  expect(text).toContain("newmom.notes · TikTok · saved");
  // No photo: no blush placeholder on the item page, so the reading starts higher.
  expect(hero.root.findAllByType("Image" as React.ElementType)).toHaveLength(0);
  await act(async () => hero.update(<SourceHero record={post({ relevance: null })} title="Reference charts" topic="" />));
  expect(hero.root.findAll((node) => node.props.icon === "calendar-outline")).toHaveLength(0);
});

it("reads in order: what it says, numbered points with slide lines, then Open post and Add a note side by side", async () => {
  const content = await render(<SourceContent record={post()} onError={vi.fn()} />);
  const text = texts(content);
  expect(text.indexOf("What it says")).toBeLessThan(text.indexOf("Charts for the first weeks."));
  expect(text.indexOf("Charts for the first weeks.")).toBeLessThan(text.indexOf("Key points"));
  const first = content.root.findAll((node) => node.props.accessibilityLabel === "1. Feeding: 8–12 times a day. Slide 2");
  expect(first.length).toBeGreaterThan(0);
  expect(text).not.toContain("(slide 2)");
  const buttons = content.root.findAllByType("Button" as React.ElementType).map((button) => button.props.title);
  expect(buttons).toEqual(["Open post", "Add a note"]);
  await act(async () => content.root.findAllByType("Button" as React.ElementType)[1].props.onPress());
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/edit", params: { id: "post", kind: "source" } });
  // Her own note turns the action into an edit; a private note with no link has no Open post.
  await act(async () => content.update(<SourceContent record={post({ url: undefined }, "Ask the nurse")} onError={vi.fn()} />));
  expect(content.root.findAllByType("Button" as React.ElementType).map((button) => button.props.title)).toEqual(["Edit note"]);
});

it("stacks the actions at the largest text sizes", async () => {
  mock.font = 2.4;
  const content = await render(<SourceContent record={post()} onError={vi.fn()} />);
  const row = content.root.findAllByType("View" as React.ElementType).find((node) => node.findAllByType("Button" as React.ElementType).length === 2
    && node.props.style?.gap === 12)!;
  expect(row.props.style.flexDirection).toBe("column");
});

it("keeps timing, what was read, reading again and who can see it closed under More about this post", async () => {
  mock.who = "Your family";
  const more = await render(<SourceMore record={post()} onTiming={vi.fn()} onError={vi.fn()} />);
  const rows = more.root.findAllByType("Disclosure" as React.ElementType)
    .map((node) => [node.props.title, node.props.detail]);
  expect(rows.slice(0, 2)).toEqual([["When this shows up on Today", "From 0 weeks"], ["What was read from this post", "Caption and 2 slides"]]);
  expect(rows.at(-1)).toEqual(["Who can see it", "Your family"]);
  expect(more.root.findAllByType("SourceRecovery" as React.ElementType)).toHaveLength(1);
  expect(texts(more)).toContain("More about this post");
  // A post that's missing content has its recovery up top, so it isn't repeated here; no family, no sharing row.
  mock.who = null;
  await act(async () => more.update(<SourceMore record={post({ status: "incomplete" })} onTiming={vi.fn()} onError={vi.fn()} />));
  expect(more.root.findAllByType("SourceRecovery" as React.ElementType)).toHaveLength(0);
  expect(more.root.findAllByType("Disclosure" as React.ElementType).some((node) => node.props.title === "Who can see it")).toBe(false);
});

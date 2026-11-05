import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ approved: false }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Linking: { openURL: vi.fn(async () => undefined) }, useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("../components/ui", () => ({ Copy: "Copy", Icon: "Icon", PressTarget: "PressTarget", fonts: {}, useColors: () => ({}) }));
vi.mock("@/lib/weekly-content", async () => {
  const real = await import("./weekly-content");
  // The same function and batch, with its one switch as this test sets it.
  return { ...real, weekContent: (week: number, options: { preview?: boolean } = {}) => real.weekContent(week, { ...options, from: real.batches.map((batch) => ({ ...batch, approved: mock.approved })) }),
    ageContent: (age: BabyAge, options: { preview?: boolean } = {}) => real.ageContent(age, { ...options, from: real.ageBatches.map((batch) => ({ ...batch, approved: mock.approved })) }) };
});
import { AgeFacts, WeekFacts } from "../components/week-facts";
import { ageBatches, batches, type BabyAge } from "./weekly-content";

const week35 = batches[0].weeks.find((week) => week.week === 35)!;
let renderer: ReactTestRenderer | undefined;
async function mount(week = 35) { await act(async () => { renderer = create(<WeekFacts week={week} />); }); }
const words = () => JSON.stringify(renderer!.toJSON());
const devButton = () => renderer!.root.findAll((n) => String(n.type) === "PressTarget").find((n) => String(n.props.accessibilityLabel).startsWith("Development only"));
const waiting = "Weekly facts coming after a doctor’s review.";

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined); mock.approved = false; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("below the week card", () => {
  it("leaves the waiting line to the card, and has nothing to add in a release build", async () => {
    vi.stubGlobal("__DEV__", false);
    await act(async () => { renderer = create(<WeekFacts week={35} waiting={false} />); });
    expect(renderer!.toJSON()).toBeNull();
  });
});
describe("while the batch isn't approved", () => {
  it("shows the waiting line and no fact or number, with no way to preview in a release build", async () => {
    vi.stubGlobal("__DEV__", false);
    await mount();
    expect(words()).toContain(waiting);
    expect(words()).not.toContain("lb");
    expect(words()).not.toContain(" in (");
    expect(words()).not.toContain("melon");
    for (const fact of week35.facts) expect(words()).not.toContain(fact.text);
    expect(devButton()).toBeUndefined();
  });
  it("a development build can preview, clearly labelled, and go back", async () => {
    vi.stubGlobal("__DEV__", true);
    await mount();
    expect(words()).toContain(waiting);
    await act(async () => devButton()!.props.onPress());
    expect(words()).toContain("Development only. Not reviewed by a doctor.");
    expect(words()).toContain(week35.facts[0].text);
    expect(words()).not.toContain(waiting);
    await act(async () => devButton()!.props.onPress());
    expect(words()).toContain(waiting);
    expect(words()).not.toContain("lb");
  });
  it("offers no preview for a week with nothing to preview", async () => {
    vi.stubGlobal("__DEV__", true);
    await mount(3);
    expect(words()).toContain(waiting);
    expect(devButton()).toBeUndefined();
  });
});

describe("once the batch is approved", () => {
  it("shows the size in lb/oz and inches first, and three facts, with no development wording", async () => {
    mock.approved = true;
    vi.stubGlobal("__DEV__", false);
    await mount();
    const text = words();
    expect(text).toContain("Roughly a honeydew melon, by weight");
    expect(text).toContain("about 5 lb 6 oz (2.4 kg)");
    expect(text).toContain("about 18.0 in (45.8 cm)");
    for (const fact of week35.facts) expect(text).toContain(fact.text);
    expect(text).not.toContain(waiting);
    expect(text).not.toContain("Development only");
  });
  it("has every fact's sources one tap away", async () => {
    mock.approved = true;
    await mount();
    const toggle = renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => n.props.accessibilityLabel === "Sources")!;
    await act(async () => toggle.props.onPress());
    const links = renderer!.root.findAll((n) => String(n.type) === "PressTarget").map((n) => n.props.accessibilityLabel).join();
    for (const name of ["marchofdimes.org", "kidshealth.org", "cdc.gov", "nhs.uk", "intergrowth21.com"]) expect(links).toContain(name);
  });
  it("a week outside every batch still gets the waiting line", async () => {
    mock.approved = true;
    await mount(3);
    expect(words()).toContain(waiting);
  });
  it("a week with only a stated size shows that, with its link, and no number or table", async () => {
    mock.approved = true;
    await mount(7);
    expect(words()).toContain("Roughly a blueberry");
    expect(words()).not.toContain("by weight");
    expect(words()).not.toContain(" oz");
    const toggle = renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => n.props.accessibilityLabel === "Sources")!;
    await act(async () => toggle.props.onPress());
    expect(words()).not.toContain("Sizes:");
    expect(renderer!.root.findAll((n) => String(n.type) === "PressTarget").map((n) => n.props.accessibilityLabel).join()).toContain("kidshealth.org");
  });
  it("a week from WHO's chart shows its weight, under a pound in ounces, and no length", async () => {
    mock.approved = true;
    await mount(14);
    expect(words()).toContain("about 3 oz (90 g)");
    expect(words()).toContain("Roughly a lemon, by weight");
    expect(words()).not.toContain(" in (");
  });
});

describe("after birth", () => {
  const waitingAge = "What’s typical at this age is coming once a doctor has reviewed it.";
  const line = ageBatches[0].periods[0].items[0].text;
  it("shows the waiting line and no fact in a release build while unapproved", async () => {
    vi.stubGlobal("__DEV__", false);
    await act(async () => { renderer = create(<AgeFacts age={{ unit: "week", age: 1 }} />); });
    expect(words()).toContain(waitingAge);
    expect(words()).not.toContain(line);
    expect(devButton()).toBeUndefined();
  });
  it("a development build can preview it, clearly labelled", async () => {
    vi.stubGlobal("__DEV__", true);
    await act(async () => { renderer = create(<AgeFacts age={{ unit: "week", age: 1 }} />); });
    await act(async () => devButton()!.props.onPress());
    expect(words()).toContain("Development only. Not reviewed by a doctor.");
    expect(words()).toContain(line);
  });
  it("once approved, shows the lines and the note, with sources one tap away", async () => {
    mock.approved = true;
    vi.stubGlobal("__DEV__", false);
    await act(async () => { renderer = create(<AgeFacts age={{ unit: "week", age: 1 }} />); });
    expect(words()).toContain(line);
    expect(words()).toContain("Every baby goes at their own pace");
    expect(words()).not.toContain("Development only");
    const toggle = renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => n.props.accessibilityLabel === "Sources")!;
    await act(async () => toggle.props.onPress());
    expect(renderer!.root.findAll((n) => String(n.type) === "PressTarget").map((n) => n.props.accessibilityLabel).join()).toContain("healthychildren.org");
  });
});

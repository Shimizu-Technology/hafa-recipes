import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ approved: false }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Linking: { openURL: vi.fn(async () => undefined) }, useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("../components/ui", () => ({ Copy: "Copy", Icon: "Icon", PressTarget: "PressTarget", fonts: {}, useColors: () => ({}) }));
vi.mock("@/lib/weekly-content", async () => {
  const real = await import("./weekly-content");
  // The same function and batch, with its one switch as this test sets it.
  return { ...real, weekContent: (week: number, options: { preview?: boolean } = {}) => real.weekContent(week, { ...options, from: real.batches.map((batch) => ({ ...batch, approved: mock.approved })) }) };
});
import { WeekFacts } from "../components/week-facts";
import { batches } from "./weekly-content";

const week35 = batches[0].weeks.find((week) => week.week === 35)!;
let renderer: ReactTestRenderer | undefined;
async function mount(week = 35) { await act(async () => { renderer = create(<WeekFacts week={week} />); }); }
const words = () => JSON.stringify(renderer!.toJSON());
const devButton = () => renderer!.root.findAll((n) => String(n.type) === "PressTarget").find((n) => String(n.props.accessibilityLabel).startsWith("Development only"));
const waiting = "Weekly facts are coming once a doctor has reviewed them.";

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined); mock.approved = false; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
    await mount(20);
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
  it("a week outside the batch still gets the waiting line", async () => {
    mock.approved = true;
    await mount(20);
    expect(words()).toContain(waiting);
  });
});

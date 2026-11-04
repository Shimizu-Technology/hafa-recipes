import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ push: vi.fn(), fontScale: 1 }));
vi.mock("react-native", () => ({ Text: "Text", View: "View", useWindowDimensions: () => ({ fontScale: f.fontScale }) }));
vi.mock("expo-router", () => ({ router: { push: f.push } }));
vi.mock("../components/ui", () => ({ Card: "Card", Copy: "Copy", Icon: "Icon", PressTarget: "PressTarget", radii: {}, tap() {}, typeScale: {}, useColors: () => ({}) }));
import { BabySetupCard, StageOptions } from "../components/stage-options";

let view: ReactTestRenderer;
const texts = () => view.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children);
const target = (label: string) => view.root.find((n) => (n.type as unknown) === "PressTarget" && n.props.accessibilityLabel === label);
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); f.push.mockClear(); f.fontScale = 1; });
afterEach(() => { act(() => view.unmount()); vi.unstubAllGlobals(); });

it("gives someone with no baby the one choice, says why, and opens setup with it made", async () => {
  await act(async () => { view = create(<BabySetupCard child={null} />); });
  expect(texts()).toEqual(["Is your baby here yet?", "Feeds, kicks and everything else you can track start here once your baby has a profile."]);
  expect(JSON.stringify(view.toJSON())).not.toContain("small moment");
  await act(async () => target("I’m expecting").props.onPress());
  expect(f.push).toHaveBeenLastCalledWith({ pathname: "/child", params: { stage: "expecting" } });
  await act(async () => target("Baby’s here").props.onPress());
  expect(f.push).toHaveBeenLastCalledWith({ pathname: "/child", params: { stage: "here" } });
});

it("opens a named baby's own profile", async () => {
  await act(async () => { view = create(<BabySetupCard child={{ id: "kid", name: "Mia", revision: 1 }} />); });
  expect(texts()[0]).toBe("Is Mia here yet?");
  await act(async () => target("Baby’s here").props.onPress());
  expect(f.push).toHaveBeenLastCalledWith({ pathname: "/child", params: { stage: "here", id: "kid" } });
});

it("puts the choices ahead of the explanation at the largest text", async () => {
  f.fontScale = 2;
  await act(async () => { view = create(<BabySetupCard child={null} />); });
  const order = JSON.stringify(view.toJSON()), why = order.indexOf("Feeds, kicks"), choice = order.indexOf("I’m expecting");
  expect(choice).toBeGreaterThan(-1);
  expect(why).toBeGreaterThan(choice);
  expect(view.root.findAll((n) => (n.type as unknown) === "Copy")[0].props.kind).toBe("label");
});

it("marks the choice for VoiceOver in setup, and stacks at large text", async () => {
  f.fontScale = 1.5;
  await act(async () => { view = create(<StageOptions labels={{ expecting: "Still expecting", here: "Baby’s here" }} value="here" onChoose={() => {}} />); });
  expect(target("Baby’s here").props.accessibilityRole).toBe("radio");
  expect(target("Baby’s here").props.accessibilityState).toEqual({ selected: true, checked: true });
  expect(target("Still expecting").props.accessibilityState).toEqual({ selected: false, checked: false });
  expect(view.root.findByType("View" as React.ElementType).props.style.flexDirection).toBe("column");
});

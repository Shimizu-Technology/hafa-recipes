import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ preference: null as boolean | null, timings: [] as Array<{ value: any; config: any; stopped: boolean }> }));
vi.mock("../components/design/foundation", () => ({ useMotionPreference: () => f.preference, useReducedMotion: () => f.preference ?? true }));
vi.mock("react-native", () => {
  class Value {
    value: number; constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; }
    stopAnimation() { f.timings.filter(t => t.value === this).forEach(t => { t.stopped = true; }); }
    interpolate() { return "offset"; }
  }
  return { Platform: { OS: "ios" }, Easing: { bezier: () => (t: number) => t }, Animated: {
    View: "AnimatedView", Value,
    timing: (value: Value, config: object) => { const pending = { value, config, stopped: false }; f.timings.push(pending); return { start() { value.setValue(0.8); }, stop() { pending.stopped = true; } }; },
    spring: (value: Value) => ({ start() { value.setValue(1); } }),
  } };
});
import { Entrance, SetPop } from "../components/design/athletic-motion";
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.preference = null; f.timings = []; });
it("holds the entrance still until motion resolves, and drops translation and stagger for Reduce Motion", () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(createElement(Entrance, { index: 4 }, "Workout")); });
  expect(f.timings).toHaveLength(0);
  expect(tree.root.findByType("AnimatedView" as never).props.style.transform).toEqual([{ translateY: 0 }]);
  f.preference = true;
  act(() => tree.update(createElement(Entrance, { index: 4 }, "Workout")));
  expect(f.timings[0].config).toMatchObject({ duration: 180, delay: 0 });
  expect(tree.root.findByType("AnimatedView" as never).props.style.transform).toEqual([{ translateY: 0 }]);
  act(() => tree.unmount());
});
it("allows an in-flight set fade to finish after the preference resolves", () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(createElement(SetPop, { trigger: 0 }, "Clock")); });
  act(() => tree.update(createElement(SetPop, { trigger: 1 }, "Clock")));
  const fade = f.timings[0];
  f.preference = false;
  act(() => tree.update(createElement(SetPop, { trigger: 1 }, "Clock")));
  expect(fade.stopped).toBe(false);
  act(() => fade.value.setValue(1));
  expect(tree.root.findByType("AnimatedView" as never).props.style.opacity.value).toBe(1);
  act(() => tree.update(createElement(SetPop, { trigger: 2 }, "Clock")));
  expect(tree.root.findByType("AnimatedView" as never).props.style.opacity.value).toBe(1);
  act(() => tree.unmount());
});

it("does not pop when a completed set is undone", () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(createElement(SetPop, { trigger: 2 }, "Clock")); });
  act(() => tree.update(createElement(SetPop, { trigger: 1 }, "Clock")));
  expect(f.timings).toHaveLength(0);
  act(() => tree.unmount());
});

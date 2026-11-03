import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ reduced: true, success: vi.fn() }));
vi.mock("@/components/ui", () => ({ Copy: "Copy", haptics: { success: f.success }, useColors: () => ({ accent: "coral" }), useReducedMotion: () => f.reduced }));
vi.mock("@/lib/look-context", () => ({ useLook: () => ({ id: "athletic" }) }));
vi.mock("@/components/design/foundation", () => ({ useReducedMotion: () => f.reduced }));
vi.mock("react-native", () => {
  class Value {
    value: number;
    constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; }
    stopAnimation() {}
  }
  return { Platform: { OS: "ios" }, Easing: { bezier: () => (t: number) => t }, Animated: {
    View: "AnimatedView", Value,
    // Leave the fade between frames so a preference change can interrupt it.
    timing: (value: Value) => ({ start() { value.setValue(0.8); }, stop() {} }),
    spring: (value: Value) => ({ start() { value.setValue(1); }, stop() {} }),
    parallel: (animations: { start(): void; stop(): void }[]) => ({ start() { animations.forEach(a => a.start()); }, stop() { animations.forEach(a => a.stop()); } }),
  } };
});
import { LookPop } from "../components/design/look-motion";
import { PRMarker } from "../components/pr-marker";
it("defers a saved record's feedback until Progress is visible", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.success.mockClear();
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(createElement(PRMarker, { value: "20 reps", active: true })); });
  act(() => tree.update(createElement(PRMarker, { value: "25 reps", active: false })));
  expect(f.success).not.toHaveBeenCalled();
  act(() => tree.update(createElement(PRMarker, { value: "25 reps", active: true })));
  expect(f.success).toHaveBeenCalledTimes(1);
  act(() => tree.update(createElement(PRMarker, { value: "25 reps", active: true })));
  expect(f.success).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
it("settles fully visible when the OS motion preference resolves during saved-state feedback", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.reduced = true;
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(createElement(LookPop, { trigger: 0 }, "Clock")); });
  act(() => tree.update(createElement(LookPop, { trigger: 1 }, "Clock")));
  expect(tree.root.findByType("AnimatedView" as never).props.style.opacity.value).toBe(0.8);
  f.reduced = false;
  act(() => tree.update(createElement(LookPop, { trigger: 1 }, "Clock")));
  const style = tree.root.findByType("AnimatedView" as never).props.style;
  expect(style.opacity.value).toBe(1);
  expect(style.transform[0].scale.value).toBe(1);
  act(() => tree.unmount());
});

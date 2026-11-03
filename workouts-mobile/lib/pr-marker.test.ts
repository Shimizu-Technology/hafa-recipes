import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import type { ExerciseRecord } from "./progress-insights";
const f = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../components/ui", () => ({ Copy: "Copy", haptics: { success: f.success }, useReducedMotion: () => true }));
vi.mock("react-native", () => {
  class Value { constructor(public value: number) {} setValue(value: number) { this.value = value; } stopAnimation() {} }
  return { Platform: { OS: "ios" }, Easing: { bezier: () => (t: number) => t }, Animated: { Value, View: "AnimatedView", timing: (value: Value) => ({ start() { value.setValue(1); } }) } };
});
import { PRMarker } from "../components/pr-marker";
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.success.mockClear(); });
it("celebrates only comparable improvements, including a deferred best, and resets on units changes", () => {
  let tree!: ReactTestRenderer;
  const show = (value: number, active = true, metric: ExerciseRecord["measure"]["metric"] = "reps", units = "metric", reps?: number) => {
    const props = { value: String(value), measure: { metric, value, reps }, active, key: units };
    act(() => { if (tree) tree.update(createElement(PRMarker, props)); else tree = create(createElement(PRMarker, props)); });
  };
  show(20); expect(f.success).not.toHaveBeenCalled();
  show(15); expect(f.success).not.toHaveBeenCalled();
  show(10, false); show(10); expect(f.success).not.toHaveBeenCalled();
  show(25, false); expect(f.success).not.toHaveBeenCalled();
  show(25); expect(f.success).toHaveBeenCalledTimes(1);
  show(100, true, "kg"); expect(f.success).toHaveBeenCalledTimes(1);
  show(100, true, "kg", "metric", 5); expect(f.success).toHaveBeenCalledTimes(2);
  show(100, true, "kg", "imperial", 8); expect(f.success).toHaveBeenCalledTimes(2);
  show(101, true, "kg", "imperial", 8); expect(f.success).toHaveBeenCalledTimes(3);
  act(() => tree.unmount());
});

import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ reduced: false, timing: vi.fn(), bezier: vi.fn(() => "ease-out") }));
vi.mock("react-native", () => {
  class Value { value: number; constructor(v: number) { this.value = v; } setValue(v: number) { this.value = v; } }
  return {
    Animated: { Value, timing: (...args: unknown[]) => { f.timing(...args); return { start() {} }; }, createAnimatedComponent: (c: unknown) => c },
    Easing: { bezier: f.bezier },
    Platform: { OS: "ios" },
    Pressable: "Pressable",
  };
});
vi.mock("../components/design/foundation", () => ({ useReducedMotion: () => f.reduced }));
import { usePressScale } from "../components/design/press";

type Press = ReturnType<typeof usePressScale>;
function mount(disabled = false) {
  let press: Press | undefined;
  function Probe() { press = usePressScale(disabled); return null; }
  act(() => { create(createElement(Probe)); });
  return press!;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.reduced = false; f.timing.mockReset(); f.bezier.mockClear();
});

it("presses in to 0.97 in 120ms and releases in 160ms with the shared ease-out on the native driver", () => {
  const press = mount();
  press.onPressIn();
  press.onPressOut();
  expect(f.timing.mock.calls.map(([, config]) => config)).toEqual([
    { toValue: 0.97, duration: 120, easing: "ease-out", useNativeDriver: true },
    { toValue: 1, duration: 160, easing: "ease-out", useNativeDriver: true },
  ]);
  expect(f.bezier).toHaveBeenCalledWith(0.23, 1, 0.32, 1);
});

it("does not move under Reduce Motion and dims while held instead", () => {
  f.reduced = true;
  const press = mount();
  press.onPressIn();
  expect(f.timing).not.toHaveBeenCalled();
  expect((press.opacity as unknown as { value: number }).value).toBe(0.8);
  expect((press.scale as unknown as { value: number }).value).toBe(1);
  press.onPressOut();
  expect((press.opacity as unknown as { value: number }).value).toBe(1);
});

it("never scales a disabled control", () => {
  mount(true).onPressIn();
  expect(f.timing).not.toHaveBeenCalled();
});

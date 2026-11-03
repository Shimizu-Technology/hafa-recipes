import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const a11y = vi.hoisted(() => ({ reduced: false, listener: null as null | ((value: boolean) => void) }));
const anim = vi.hoisted(() => ({ starts: 0, stops: 0, stopAnimation: 0, setValue: [] as number[] }));
vi.mock("react-native", () => {
  class Value {
    stopAnimation() { anim.stopAnimation += 1; }
    setValue(v: number) { anim.setValue.push(v); }
    interpolate() { return "scale"; }
  }
  const composite = () => ({ start: () => { anim.starts += 1; }, stop: () => { anim.stops += 1; } });
  return {
    Platform: { OS: "ios" },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(a11y.reduced),
      addEventListener: (_: string, listener: (value: boolean) => void) => { a11y.listener = listener; return { remove() {} }; },
    },
    Animated: { Value, View: "AnimatedView", timing: () => composite(), sequence: () => composite() },
  };
});
const haptics = vi.hoisted(() => ({ taps: [] as string[] }));
vi.mock("../components/ui", () => ({ easeOut: () => 0, tap: (kind: string) => { haptics.taps.push(kind); } }));
import { Swell } from "../components/motion";

let renderer: ReactTestRenderer | undefined;
const view = () => renderer!.root.findByType("AnimatedView" as never);
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  a11y.reduced = false; a11y.listener = null; haptics.taps = [];
  Object.assign(anim, { starts: 0, stops: 0, stopAnimation: 0, setValue: [] });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("stops the swell and drops the scale when Reduce Motion turns on mid-animation", async () => {
  await act(async () => { renderer = create(React.createElement(Swell, null, "Filed")); });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(anim.starts).toBe(1);
  expect(haptics.taps).toEqual(["success"]);
  expect(view().props.style).toEqual({ transform: [{ scale: "scale" }] });
  await act(async () => { a11y.listener!(true); });
  expect(anim.stops).toBe(1);
  expect(anim.stopAnimation).toBe(1);
  expect(anim.setValue).toEqual([1]);
  expect(view().props.style).toBeUndefined();
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(haptics.taps).toEqual(["success"]); // no second haptic
});

it("plays only the haptic under Reduce Motion", async () => {
  a11y.reduced = true;
  await act(async () => { renderer = create(React.createElement(Swell, null, "Filed")); });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(haptics.taps).toEqual(["success"]);
  expect(anim.starts).toBe(0);
  expect(view().props.style).toBeUndefined();
});

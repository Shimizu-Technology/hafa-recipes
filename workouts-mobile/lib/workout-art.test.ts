import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("react-native-svg", () => ({ default: "Svg", Defs: "Defs", LinearGradient: "Gradient", Rect: "Rect", Stop: "Stop", Path: "Path" }));
vi.mock("../components/design/foundation", () => ({ Copy: "Copy", useColors: () => ({}) }));
vi.mock("../components/brand-mark", () => ({ BrandMark: "BrandMark" }));
import { WorkoutArt } from "../components/workout-art";
it.each([false, true])("hides only the wordmark when a corner badge is present (%s)", async cornerBadge => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(WorkoutArt, { title: "Ignored title", meta: "EMOM 10", cornerBadge })); });
  const text = view.root.findAllByType("Copy" as never).map(t => t.props.children);
  expect(text.includes("HÅFA")).toBe(!cornerBadge);
  expect(text).toContain("10");
  expect(view.root.findAllByType("BrandMark" as never)).toHaveLength(1);
  await act(async () => view.unmount());
});

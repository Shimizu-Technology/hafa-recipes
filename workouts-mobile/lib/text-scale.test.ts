import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock("react-native", () => ({
  Text: "Text", View: "View", Platform: { OS: "ios" }, AccessibilityInfo: {},
  StyleSheet: { flatten: (styles: object[]) => Object.assign({}, ...styles.filter(Boolean)) },
  useColorScheme: () => "light", useWindowDimensions: () => ({ fontScale: state.fontScale }),
}));
vi.mock("expo-haptics", () => ({}));
import { Copy } from "../components/design/foundation";

it("rescales and remounts native text when the system text size changes", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.fontScale = 1;
  let view: ReturnType<typeof create>;
  act(() => { view = create(createElement(Copy, null, "Workout")); });
  const original = view!.root.findByType("Text" as never);
  const size = original.props.style.fontSize;
  state.fontScale = 2;
  act(() => view!.update(createElement(Copy, null, "Workout")));
  const updated = view!.root.findByType("Text" as never);
  expect(updated).not.toBe(original);
  expect(updated.props.style.fontSize).toBe(size * 2);
  expect(updated.props.allowFontScaling).toBe(false);
  act(() => view!.unmount());
});

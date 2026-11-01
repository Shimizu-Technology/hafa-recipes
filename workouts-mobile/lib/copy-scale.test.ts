import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ fontScale: 3.1 }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  Platform: { OS: "ios" }, Text: "Text", View: "View",
  StyleSheet: { flatten: (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) },
  useColorScheme: () => "light", useWindowDimensions: () => ({ width: 390, height: 844, fontScale: f.fontScale }),
}));
vi.mock("expo-haptics", () => ({}));
import { Copy } from "../components/design/foundation";

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
const fontSize = (props: Record<string, unknown>) => {
  act(() => { renderer = create(createElement(Copy, { kind: "label", ...props }, "Pause")); });
  return (renderer!.root.findByType("Text" as never).props.style as { fontSize: number }).fontSize;
};

it("grows with the text-size setting unless a control caps it", () => {
  const base = fontSize({ allowFontScaling: false });
  act(() => renderer?.unmount());
  expect(fontSize({})).toBeCloseTo(base * 3.1);
  act(() => renderer?.unmount());
  expect(fontSize({ maxScale: 1.6 })).toBeCloseTo(base * 1.6);
  act(() => renderer?.unmount());
  f.fontScale = 1.2;
  expect(fontSize({ maxScale: 1.6 })).toBeCloseTo(base * 1.2);
});

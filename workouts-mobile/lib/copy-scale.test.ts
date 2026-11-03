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

it("selects the named face from a caller's merged UI weight and uses condensed uppercase headings", () => {
  act(() => { renderer = create(createElement(Copy, { style: { fontWeight: "700" } }, "Save")); });
  expect(renderer!.root.findByType("Text" as never).props.style).toMatchObject({ fontFamily: "Inter_700Bold", fontWeight: "400" });
  act(() => renderer?.unmount());
  act(() => { renderer = create(createElement(Copy, { kind: "heading" }, "Training")); });
  expect(renderer!.root.findByType("Text" as never).props.style).toMatchObject({ fontFamily: "BarlowCondensed_700Bold", textTransform: "uppercase", letterSpacing: 0.25 });
});

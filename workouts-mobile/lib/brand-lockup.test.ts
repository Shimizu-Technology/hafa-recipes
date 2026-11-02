import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ width: 390 }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" }, Text: "Text", View: "View",
  useColorScheme: () => "light", useWindowDimensions: () => ({ width: f.width, height: 800 }),
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect" }));
vi.mock("../components/design/foundation", () => ({ useColors: () => ({ text: "text", muted: "muted" }) }));
import { BrandLockup } from "../components/brand-mark";

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
function texts() {
  act(() => { renderer = create(createElement(BrandLockup, { fill: true })); });
  return renderer!.root.findAllByType("Text" as never).map((node) => ({
    multiplier: node.props.maxFontSizeMultiplier as number,
    fontSize: Object.assign({}, ...(node.props.style as object[]).filter(Boolean)).fontSize as number,
    lines: node.props.numberOfLines as number,
  }));
}

it("allows the wordmark to scale and wrap on regular phones", () => {
  f.width = 390;
  expect(texts()).toEqual([{ multiplier: undefined, fontSize: 20, lines: undefined }, { multiplier: undefined, fontSize: 20, lines: undefined }]);
  expect(renderer!.root.findByType("Svg" as never).props.height).toBe(24);
});

it("allows the compact wordmark to scale and wrap", () => {
  f.width = 320;
  expect(texts()).toEqual([{ multiplier: undefined, fontSize: 16, lines: undefined }, { multiplier: undefined, fontSize: 16, lines: undefined }]);
  expect(renderer!.root.findByType("Svg" as never).props.height).toBe(20);
});

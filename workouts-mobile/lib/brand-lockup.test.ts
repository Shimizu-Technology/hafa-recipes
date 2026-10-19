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

it("renders the wordmark as two single-line texts that grow to 1.2x on regular phones", () => {
  f.width = 390;
  expect(texts()).toEqual([{ multiplier: 1.2, fontSize: 18, lines: 1 }, { multiplier: 1.2, fontSize: 18, lines: 1 }]);
  expect(renderer!.root.findByType("Svg" as never).props.height).toBe(24);
});

it("steps down to a fixed 16pt wordmark on 320pt headers so it fits beside two header actions", () => {
  f.width = 320;
  expect(texts()).toEqual([{ multiplier: 1, fontSize: 16, lines: 1 }, { multiplier: 1, fontSize: 16, lines: 1 }]);
  expect(renderer!.root.findByType("Svg" as never).props.height).toBe(20);
});

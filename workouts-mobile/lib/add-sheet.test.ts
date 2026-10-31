import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn(), os: "ios" }));
vi.mock("react-native", () => ({ ScrollView: "ScrollView", Platform: { get OS() { return f.os; } } }));
vi.mock("expo-router", () => ({ router: { replace: f.replace, back: f.back, push: f.push } }));
vi.mock("@/components/ui", () => ({ Copy: "Copy", IconButton: "IconButton", Row: "Row", ListGroup: "ListGroup", ListRow: "ListRow", useColors: () => ({ groupedBackground: "grouped" }) }));
import Add from "../app/add";
let tree: ReactTestRenderer;
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.clearAllMocks(); f.os = "ios"; frames = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
});
afterEach(async () => { if (tree) await act(() => tree.unmount()); vi.unstubAllGlobals(); });
const choices = [
  ["Paste a link", "/extract"], ["Record/upload", "/capture"], ["Build a workout", "/add-workout"],
  ["Import a plan", "/extract"], ["Build a plan", "/build-plan"],
] as const;
it.each(choices)("dismisses the native sheet before opening %s", async (label, path) => {
  await act(() => { tree = create(createElement(Add)); });
  const row = tree.root.findAllByType("ListRow" as any).find(row => row.props.title === label)!;
  await act(() => row.props.onPress());
  expect(f.back).toHaveBeenCalledOnce();
  expect(f.push).not.toHaveBeenCalled();
  await act(() => frames[0](0));
  expect(f.push).toHaveBeenCalledExactlyOnceWith(path);
  expect(f.replace).not.toHaveBeenCalled();
  await act(() => row.props.onPress());
  expect(f.back).toHaveBeenCalledOnce();
});
it("replaces the regular web route without retaining an Add page in history", async () => {
  f.os = "web";
  await act(() => { tree = create(createElement(Add)); });
  await act(() => tree.root.findAllByType("ListRow" as any)[0].props.onPress());
  expect(f.replace).toHaveBeenCalledExactlyOnceWith("/extract");
  expect(f.back).not.toHaveBeenCalled();
});
it("provides an in-content close action where Android sheets have no native header", async () => {
  f.os = "android";
  await act(() => { tree = create(createElement(Add)); });
  await act(() => tree.root.findByType("IconButton" as any).props.onPress());
  expect(f.back).toHaveBeenCalledOnce();
});

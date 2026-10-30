import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  fontScale: 1, reduced: false, listener: null as null | ((value: boolean) => void),
  timings: [] as { toValue: number; duration: number; useNativeDriver: boolean }[],
  baby: { online: true, syncing: false, error: "", state: { outbox: [] as any[] } }, push: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput",
  ActivityIndicator: "ActivityIndicator", InputAccessoryView: "InputAccessoryView", KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" }, Keyboard: { dismiss: vi.fn() },
  useColorScheme: () => "light", useWindowDimensions: () => ({ fontScale: mock.fontScale }),
  AccessibilityInfo: { isReduceMotionEnabled: async () => mock.reduced,
    addEventListener: (_: string, callback: (value: boolean) => void) => { mock.listener = callback; return { remove() {} }; } },
  Easing: { bezier: vi.fn() },
  Animated: {
    Value: class { value: number; constructor(v: number) { this.value = v; } setValue(v: number) { this.value = v; } stopAnimation() {} },
    createAnimatedComponent: () => "AnimatedPressable",
    timing: (_: unknown, config: any) => { mock.timings.push(config); return { start() {} }; },
    parallel: () => ({ start() {} }),
  },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon", MaterialCommunityIcons: "CareIcon" }));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => {} }));
vi.mock("expo-router", () => ({ router: { push: mock.push } }));
vi.mock("../components/brand-mark", () => ({ BrandMark: "BrandMark" }));
vi.mock("@/lib/input-purpose", () => ({ inputTraits: () => ({}) }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
import { Copy, PressTarget, Row, Chips } from "../components/ui";
import { SyncStatus } from "../components/sync-status";
let renderer: ReactTestRenderer | undefined;
async function mount(element: React.ReactElement) {
  await act(async () => { renderer = create(element); });
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.fontScale = 1; mock.reduced = false; mock.timings = [];
  mock.baby = { online: true, syncing: false, error: "", state: { outbox: [] } };
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it("uses short native press feedback and honours a live Reduce Motion change", async () => {
  await mount(<PressTarget accessibilityLabel="Feed" />);
  const control = renderer!.root.findByType("AnimatedPressable" as React.ElementType);
  await act(async () => control.props.onPressIn({}));
  expect(mock.timings).toContainEqual(expect.objectContaining({ toValue: 0.97, duration: 120, useNativeDriver: true }));
  mock.timings = [];
  await act(async () => control.props.onPressOut({}));
  expect(mock.timings.every(t => t.duration === 160)).toBe(true);
  await act(async () => mock.listener!(true));
  mock.timings = [];
  await act(async () => control.props.onPressIn({}));
  expect(mock.timings.map(t => t.toValue)).toEqual([1, 0.82]);
});
it("remeasures visible text after a live scale change without clipping line heights or capping content", async () => {
  await mount(<Copy kind="title">A longer entry heading</Copy>);
  const original = renderer!.root.findByType("Text" as React.ElementType);
  expect(original.props.style.lineHeight).toBe(36);
  mock.fontScale = 3.1;
  await act(async () => renderer!.update(<Copy kind="title">A longer entry heading</Copy>));
  const large = renderer!.root.findByType("Text" as React.ElementType);
  expect(large).not.toBe(original);
  expect(large.props.style.lineHeight).toBeUndefined();
  expect(large.props.maxFontSizeMultiplier).toBe(0);
});
it("keeps full row labels and wrapping choices reachable at large text", async () => {
  mock.fontScale = 3.1;
  await mount(<><Row title="A long entry for this child's care" detail="A full description" onPress={() => {}} />
    <Chips value="a" label="Kind" options={[{ label: "Doctor questions", value: "a" }]} onChange={() => {}} /></>);
  const text = renderer!.root.findAllByType("Text" as React.ElementType);
  expect(text.every(t => t.props.maxFontSizeMultiplier === 0)).toBe(true);
  expect(text.every(t => !t.props.numberOfLines)).toBe(true);
  const choice = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).find(c => c.props.accessibilityRole === "radio")!;
  expect(choice.props.accessibilityState).toEqual({ selected: true, checked: true });
});
it("keeps normal sync quiet but expands rejected changes for action", async () => {
  mock.baby.state.outbox = [{ id: "queued" }]; mock.baby.syncing = true;
  await mount(<SyncStatus />);
  expect(renderer!.root.findByType("Text" as React.ElementType).props.numberOfLines).toBe(1);
  expect(renderer!.root.findByType("AnimatedPressable" as React.ElementType).props.accessibilityLabel).toContain("syncing");
  mock.baby.state.outbox[0].error = "Upload failed";
  await act(async () => renderer!.update(<SyncStatus />));
  expect(renderer!.root.findByType("AnimatedPressable" as React.ElementType).props.accessibilityLabel).toContain("needs attention");
  mock.baby.state.outbox[0].localOnly = true;
  await act(async () => renderer!.update(<SyncStatus />));
  expect(renderer!.root.findByType("Text" as React.ElementType).props.numberOfLines).toBe(1);
});

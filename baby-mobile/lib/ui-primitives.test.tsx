import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  fontScale: 1, reduced: false, scheme: "light", listener: null as null | ((value: boolean) => void),
  timings: [] as { toValue: number; duration: number; useNativeDriver: boolean }[],
  baby: { online: true, syncing: false, error: "", state: { outbox: [] as any[] } }, push: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput",
  ActivityIndicator: "ActivityIndicator", InputAccessoryView: "InputAccessoryView", KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" }, Keyboard: { dismiss: vi.fn() },
  useColorScheme: () => mock.scheme, useWindowDimensions: () => ({ fontScale: mock.fontScale }),
  AccessibilityInfo: { isReduceMotionEnabled: async () => mock.reduced, isScreenReaderEnabled: async () => false,
    addEventListener: (_: string, callback: (value: boolean) => void) => { mock.listener = callback; return { remove() {} }; } },
  Easing: { bezier: vi.fn(), cubic: vi.fn(), out: (value: unknown) => value, in: (value: unknown) => value },
  Animated: {
    View: "AnimatedView",
    Value: class { value: number; constructor(v: number) { this.value = v; } setValue(v: number) { this.value = v; } stopAnimation() {} interpolate() { return 0; } },
    createAnimatedComponent: () => "AnimatedPressable",
    timing: (_: unknown, config: any) => { mock.timings.push(config); return { start() {} }; },
    parallel: () => ({ start() {} }),
  },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon", MaterialCommunityIcons: "CareIcon" }));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => {} }));
vi.mock("expo-router", () => ({ router: { push: mock.push }, useSegments: () => ["(tabs)", "index"], Tabs: Object.assign(({ children }: any) => React.createElement("Tabs", null, children), { Screen: () => null }) }));
vi.mock("../components/brand-mark", () => ({ BrandMark: "BrandMark" }));
vi.mock("@/lib/input-purpose", () => ({ inputTraits: () => ({}) }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/components/ui", () => import("../components/ui"));
import TabLayout from "../app/(tabs)/_layout";
import { Copy, PressTarget, Row, Chips, ToastProvider, Button, useToast } from "../components/ui";
import { SyncStatus } from "../components/sync-status";
let renderer: ReactTestRenderer | undefined;
async function mount(element: React.ReactElement) {
  await act(async () => { renderer = create(element); });
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.fontScale = 1; mock.reduced = false; mock.scheme = "light"; mock.timings = [];
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

it.each(["light", "dark"])("uses a neutral selected chip with readable contrast and radio state in %s", async scheme => {
  mock.scheme = scheme;
  await mount(<Chips label="Show" value="question" options={[{ label: "Doctor questions", value: "question" }]} onChange={() => {}} />);
  const chip = renderer!.root.findByType("AnimatedPressable" as React.ElementType);
  const style = Object.assign({}, ...chip.props.style);
  const text = renderer!.root.findByType("Text" as React.ElementType).props.style;
  expect(style.backgroundColor).toBe(scheme === "light" ? "#EFE6DD" : "#231E1A");
  expect(chip.props.accessibilityState).toEqual({ checked: true, selected: true });
  function luminance(hex: string) {
    const rgb = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  const a = luminance(text.color), b = luminance(style.backgroundColor);
  expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThan(4.5);
});

it.each([false, true])("keeps long choices wrapping or horizontally intrinsic (scroll=%s, M4)", async scroll => {
  mock.fontScale = 3.1;
  const labels = ["Doctor questions and observations to bring to our next appointment",
    "A long saved-source topic with multilingual text 日本語 and a full untruncated label"];
  await mount(<Chips scroll={scroll} label="Show" value="0"
    options={labels.map((label, i) => ({ label, value: String(i) }))} onChange={() => {}} />);
  const options = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType);
  for (const option of options) {
    const style = Object.assign({}, ...option.props.style);
    expect(style.flexShrink).toBe(scroll ? 0 : 1);
    expect(style.maxWidth).toBe(scroll ? undefined : "100%");
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  }
  const texts = renderer!.root.findAllByType("Text" as React.ElementType);
  expect(texts.map(t => t.props.children)).toEqual(labels);
  expect(texts.every(t => !t.props.numberOfLines && t.props.maxFontSizeMultiplier === 0)).toBe(true);
  const scrollers = renderer!.root.findAllByType("ScrollView" as React.ElementType);
  expect(renderer!.root.findByType("View" as React.ElementType).props.style.flexWrap).toBe(scroll ? "nowrap" : "wrap");
  expect(scrollers).toHaveLength(scroll ? 1 : 0);
  if (scroll) expect(scrollers[0].props.horizontal).toBe(true);
});

it.each([1, 3.1])("keeps Undo clear of Add through a live fontScale change to %s", async fontScale => {
  mock.fontScale = 1;
  function Trigger() {
    const toast = useToast();
    return <Button title="Show toast" onPress={() => toast("Diaper logged", { label: "Undo", onPress() {} })} />;
  }
  await mount(<ToastProvider><Trigger /><TabLayout /></ToastProvider>);
  const controls = () => renderer!.root.findAllByType("AnimatedPressable" as React.ElementType);
  await act(async () => controls().find(n => n.props.accessibilityLabel === "Show toast")!.props.onPress());
  if (fontScale !== 1) {
    mock.fontScale = fontScale;
    await act(async () => renderer!.update(<ToastProvider><Trigger /><TabLayout /></ToastProvider>));
  }
  const toast = renderer!.root.findByType("AnimatedView" as React.ElementType);
  const add = controls().find(n => n.props.accessibilityLabel === "Add a source, note, or care log")!;
  const addStyle = Object.assign({}, ...add.props.style);
  expect(toast.props.style.bottom).toBeGreaterThanOrEqual(addStyle.bottom + addStyle.height + 12);
  expect(controls().some(n => n.props.accessibilityLabel === "Undo")).toBe(true);
});

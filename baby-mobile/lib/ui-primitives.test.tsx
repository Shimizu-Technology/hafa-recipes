import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  back: vi.fn(), replace: vi.fn(), canGoBack: false,
  options: [] as any[],
  fontScale: 1, reduced: false, scheme: "light", listener: null as null | ((value: boolean) => void),
  timings: [] as { toValue: number; duration: number; useNativeDriver: boolean }[],
  baby: { online: true, syncing: false, error: "", state: { outbox: [] as any[] } }, push: vi.fn(),
  scrollToTop: [] as { current: { scrollToTop: () => void } }[],
}));
/** iOS header actions arrive as one custom item; render it like headerRight. */
const headerElement = (options: any) => options?.headerRight?.() ?? options?.unstable_headerRightItems?.()[0]?.element ?? null;
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
vi.mock("expo-router", () => ({ router: { push: mock.push, back: mock.back, replace: mock.replace, canGoBack: () => mock.canGoBack }, useSegments: () => ["(tabs)", "index"], useScrollToTop: (ref: any) => { mock.scrollToTop.push(ref); }, Stack: Object.assign(({ screenOptions }: any) => React.createElement("Stack", null, headerElement(screenOptions)), { Screen: ({ options }: any) => { mock.options.push(options); return headerElement(options); } }), Tabs: Object.assign(({ children }: any) => React.createElement("Tabs", null, children), { Screen: () => null }) }));
vi.mock("../components/brand-mark", () => ({ BrandMark: "BrandMark" }));
vi.mock("@/lib/input-purpose", () => ({ inputTraits: () => ({}) }));
vi.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true, NavigationContext: React.createContext(undefined) }));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/components/ui", () => import("../components/ui"));

import { View } from "react-native";
import { CareGlance } from "../components/care-glance";
import { optimisticRecord } from "./models";
import { HeaderSearch } from "../components/header-search";
import { AccountButton, HeaderIconButton, HeaderPill, TabStack, headerActions, initials } from "../components/tab-stack";
import { Copy, PressTarget, Row, Chips, ToastProvider, Button, useToast, Screen, useColors, NativeHeaderContext, TabScreenContext, FilterChips } from "../components/ui";
import { SyncStatus } from "../components/sync-status";
let renderer: ReactTestRenderer | undefined;
async function mount(element: React.ReactElement) {
  await act(async () => { renderer = create(element); });
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.push.mockClear(); mock.back.mockClear(); mock.replace.mockClear(); mock.canGoBack = false; mock.options = []; mock.scrollToTop = [];
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
  expect(original.props.style.lineHeight).toBe(41);
  mock.fontScale = 3.1;
  await act(async () => renderer!.update(<Copy kind="title">A longer entry heading</Copy>));
  const large = renderer!.root.findByType("Text" as React.ElementType);
  expect(large).not.toBe(original);
  expect(large.props.style.lineHeight).toBe(41);
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

it.each(["light", "dark"])("uses a clearly selected cocoa chip with readable contrast and radio state in %s", async scheme => {
  mock.scheme = scheme;
  await mount(<Chips label="Show" value="question" options={[{ label: "Doctor questions", value: "question" }]} onChange={() => {}} />);
  const chip = renderer!.root.findByType("AnimatedPressable" as React.ElementType);
  const style = Object.assign({}, ...chip.props.style);
  const text = renderer!.root.findByType("Text" as React.ElementType).props.style;
  expect(style.backgroundColor).toBe(scheme === "light" ? "#5A4740" : "#E3C9B8");
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

it.each([1, 3.1])("keeps Undo above the native tab bar through a live fontScale change to %s", async fontScale => {
  mock.fontScale = 1;
  function Trigger() {
    const toast = useToast();
    return <Button title="Show toast" onPress={() => toast("Diaper logged", { label: "Undo", onPress() {} })} />;
  }
  await mount(<ToastProvider><Trigger /></ToastProvider>);
  const controls = () => renderer!.root.findAllByType("AnimatedPressable" as React.ElementType);
  await act(async () => controls().find(n => n.props.accessibilityLabel === "Show toast")!.props.onPress());
  if (fontScale !== 1) {
    mock.fontScale = fontScale;
    await act(async () => renderer!.update(<ToastProvider><Trigger /></ToastProvider>));
  }
  const toast = renderer!.root.findByType("AnimatedView" as React.ElementType);
  expect(toast.props.style.bottom).toBeGreaterThanOrEqual(34 + 80);
  expect(controls().some(n => n.props.accessibilityLabel === "Undo")).toBe(true);
});

it.each(["", undefined, "A useful subtitle"])("keeps optional subtitle %j inside Text rather than a layout View", async subtitle => {
  await mount(<Screen title="Today" subtitle={subtitle}><Copy>Care comes first</Copy></Screen>);
  const layoutChildren = renderer!.root.findAllByType("View" as React.ElementType)
    .flatMap(view => React.Children.toArray(view.props.children));
  expect(layoutChildren.filter(child => typeof child === "string")).toEqual([]);
  const text = renderer!.root.findAllByType("Text" as React.ElementType).map(node => node.props.children);
  expect(text).toContain("Today");
  if (subtitle) expect(text).toContain(subtitle);
});


it.each(["Today", "Saved", "Journal", "Ask"])("leaves Add to the tab bar and shows %s's account as initials", async title => {
  mock.baby = { ...mock.baby, state: { ...mock.baby.state, bootstrap: { profile: { display_name: "Kami Shimizu" } } } as any };
  await mount(<TabStack title={title} />);
  expect(mock.options).toEqual([]);
  const controls = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType);
  expect(controls.map(c => c.props.accessibilityLabel)).toEqual(["Settings and profiles"]);
  expect(renderer!.root.findAllByType("Text" as React.ElementType).map(node => node.props.children)).toEqual(["KS"]);
  await act(async () => controls[0].props.onPress());
  expect(mock.push).toHaveBeenLastCalledWith("/settings");
});
it.each([["Kami", "K"], ["  kami  shimizu ", "KS"], ["Mary Jane Watson", "MW"], ["Éowyn", "É"], ["", ""], ["🍼", ""]])("reads initials from %j", (name, expected) => {
  expect(initials(name)).toBe(expected);
});
it("keeps every header control's target at least 44×44 while the circles and pills stay small", async () => {
  mock.baby = { ...mock.baby, state: { ...mock.baby.state, bootstrap: { profile: { display_name: "Kami Shimizu" } } } as any };
  await mount(<View>
    <HeaderIconButton icon="ellipsis-horizontal" label="More" onPress={() => {}} />
    <HeaderPill title="Select" onPress={() => {}} />
    <AccountButton />
  </View>);
  const controls = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType);
  expect(controls.map(c => c.props.accessibilityLabel)).toEqual(["More", "Select", "Settings and profiles"]);
  for (const control of controls) {
    const target = Object.assign({}, ...control.props.style);
    expect(target).toMatchObject({ minWidth: 44, minHeight: 44 });
    const shape = control.findAllByType("View" as React.ElementType)[0].props.style;
    expect(shape.height).toBeLessThan(44);
  }
});
it("hides iOS 26's shared glass behind header actions", () => {
  const options = headerActions(React.createElement("View")) as any;
  expect(options.unstable_headerRightItems()).toEqual([{ type: "custom", element: React.createElement("View"), hidesSharedBackground: true }]);
});


it.each(["light", "dark"])("keeps enabled text at 4.5:1 across all %s surfaces", async scheme => {
  mock.scheme = scheme;
  let palette!: ReturnType<typeof useColors>;
  function Probe() { palette = useColors(); return null; }
  await mount(<Probe />);
  function rgb(value: string): number[] {
    return value.startsWith("#") ? value.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255)
      : value.match(/[\d.]+/g)!.map(Number).map((v, i) => i < 3 ? v / 255 : v);
  }
  function luminance(channels: number[]) {
    const linear = channels.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  function contrast(ink: string, ground: string) {
    const bg = rgb(ground), fg = rgb(ink), alpha = fg[3] ?? 1;
    const a = luminance(fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha))), b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  // Tab labels need 3:1 on the bar; the selected tab and Add glyph stay at 4.5:1.
  expect(contrast(palette.muted, palette.tabBar)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette.action, palette.tabBar)).toBeGreaterThanOrEqual(4.5);
  for (const ink of [palette.text, palette.muted, palette.accentText, palette.error])
    for (const ground of [palette.background, palette.hero, palette.soft, palette.surface, palette.errorBg])
      expect(contrast(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette.onAction, palette.action)).toBeGreaterThanOrEqual(4.5);
});

it("returns a tab root to its resting top, large title included, when its tab is tapped again", async () => {
  const scrollTo = vi.fn();
  const tab = (children: React.ReactNode) => <NativeHeaderContext.Provider value={true}><TabScreenContext.Provider value={true}>
    {children}</TabScreenContext.Provider></NativeHeaderContext.Provider>;
  await act(async () => { renderer = create(tab(<Screen title="Saved"><Copy>Posts</Copy></Screen>), { createNodeMock: () => ({ scrollTo }) }); });
  expect(mock.scrollToTop).toHaveLength(1);
  const scroller = renderer!.root.findByType("ScrollView" as React.ElementType);
  // iOS can only scroll back above 0 with overflow allowed; it rests at minus the header inset.
  expect(scroller.props.scrollToOverflowEnabled).toBe(true);
  act(() => mock.scrollToTop[0].current.scrollToTop());
  expect(scrollTo).not.toHaveBeenCalled();
  const drag = (y: number) => act(() => scroller.props.onScrollBeginDrag({ nativeEvent: { contentOffset: { x: 0, y } } }));
  // Ask opens scrolled to its newest message; a drag that starts mid-content isn't the top.
  drag(640);
  drag(-152);
  drag(-96);
  act(() => mock.scrollToTop[0].current.scrollToTop());
  expect(scrollTo).toHaveBeenLastCalledWith({ y: -152, animated: true });
  // Screens outside the tabs (a pushed record, a sheet) don't listen for tab presses.
  mock.scrollToTop = [];
  await act(async () => renderer!.update(<Screen title="Entry" back><Copy>Entry</Copy></Screen>));
  expect(mock.scrollToTop).toEqual([]);
  expect(renderer!.root.findByType("ScrollView" as React.ElementType).props.scrollToOverflowEnabled).toBe(false);
});
it("keeps an independent modal title and safe area inside a native tab", async () => {
  await mount(<NativeHeaderContext.Provider value={true}>
    <Screen nativeHeader={false} title="Choose category"><Copy>Selected sources stay selected</Copy></Screen>
  </NativeHeaderContext.Provider>);
  expect(renderer!.root.findAllByType("Text" as React.ElementType).map(t => t.props.children)).toContain("Choose category");
  expect(renderer!.root.findByType("SafeAreaView" as React.ElementType).props.edges).toContain("top");
});

it.each([1, 3.1])("keeps the feed number on one line at scale %s while preserving readable facts and body scaling", async fontScale => {
  mock.fontScale = fontScale;
  const now = new Date("2026-10-31T06:00:00Z"),
    feed = optimisticRecord({ id: "feed", kind: "feeding", child_id: "baby", title: "Feed", body: "", occurred_at: "2026-10-31T00:50:00Z", data: { method: "breast", side: "left", duration_minutes: 15 } });
  await mount(<CareGlance child={{ id: "baby", name: "Isla", revision: 1 }} rows={[feed]} now={now} />);
  const texts = renderer!.root.findAllByType("Text" as React.ElementType), number = texts.find(t => t.props.maxFontSizeMultiplier === 1.4)!;
  expect(number.props.children[0]).toBe("5h 10m");
  expect(number.props.numberOfLines).toBe(1);
  expect(number.props.style.fontSize).toBe(44);
  const detail = texts.find(t => t.props.children === "Left side · 15 min · Next: right")!;
  expect(detail.props.maxFontSizeMultiplier).toBe(0);
  await act(async () => renderer!.root.findByType("AnimatedPressable" as React.ElementType).props.onPress());
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/record/[id]", params: { id: "feed" } });
});

it("uses native header search and clears its query from app actions without resetting typed text", async () => {
  const onChange = vi.fn(), setText = vi.fn();
  await mount(<NativeHeaderContext.Provider value={true}><HeaderSearch value="" onChange={onChange} placeholder="Search saved posts" /></NativeHeaderContext.Provider>);
  expect(renderer!.root.findAllByType("TextInput" as React.ElementType)).toHaveLength(0);
  const search = mock.options.at(-1).headerSearchBarOptions;
  expect(search.hideWhenScrolling).toBe(false);
  search.ref.current = { setText };
  await act(async () => search.onChangeText({ nativeEvent: { text: "hospital bag" } }));
  expect(onChange).toHaveBeenLastCalledWith("hospital bag");
  await act(async () => renderer!.update(<NativeHeaderContext.Provider value={true}><HeaderSearch value="hospital bag" onChange={onChange} placeholder="Search saved posts" /></NativeHeaderContext.Provider>));
  expect(setText).not.toHaveBeenCalled();
  await act(async () => renderer!.update(<NativeHeaderContext.Provider value={true}><HeaderSearch value="" onChange={onChange} placeholder="Search saved posts" /></NativeHeaderContext.Provider>));
  expect(setText).toHaveBeenLastCalledWith("");
  await act(async () => search.onCancelButtonPress());
  expect(onChange).toHaveBeenLastCalledWith("");
});

it.each(["back", "close"])("keeps a cold-linked native %s screen escapable without navigation history", async action => {
  await mount(<NativeHeaderContext.Provider value={true}><Screen title="Entry" back={action === "back"} close={action === "close"}><Copy>Saved content</Copy></Screen></NativeHeaderContext.Provider>);
  const control = mock.options.at(-1).headerLeft();
  expect(control.props.title).toBe(action === "back" ? "Back" : "Close");
  await act(async () => control.props.onPress());
  expect(mock.replace).toHaveBeenCalledWith("/(tabs)/(today)");
  mock.canGoBack = true;
  await act(async () => control.props.onPress());
  expect(mock.back).toHaveBeenCalledOnce();
});


it.each([1, 3.1])("switches filter chips and exposes the radio selection at scale %s", async fontScale => {
  mock.fontScale = fontScale;
  const changed = vi.fn();
  function Filters() {
    const [value, setValue] = React.useState("all");
    return <FilterChips label="Journal filters" value={value}
      options={[{ label: "Everything", value: "all" }, { label: "Doctor questions", value: "question", icon: "help-circle-outline" }]}
      onChange={next => { changed(next); setValue(next); }} />;
  }
  await mount(<Filters />);
  const choices = () => renderer!.root.findAllByType("AnimatedPressable" as React.ElementType);
  expect(choices().map(choice => choice.props.accessibilityState)).toEqual([
    { selected: true, checked: true }, { selected: false, checked: false },
  ]);
  await act(async () => choices()[1].props.onPress());
  expect(changed).toHaveBeenCalledExactlyOnceWith("question");
  expect(choices().map(choice => choice.props.accessibilityState)).toEqual([
    { selected: false, checked: false }, { selected: true, checked: true },
  ]);
  // Every chip is a 34pt pill in a 44pt target: sand at rest, filled cocoa when selected.
  for (const choice of choices()) expect(choice.props.style[0]).toMatchObject({ minHeight: 44 });
  const pills = choices().map(choice => choice.findAllByType("View" as React.ElementType)[0].props.style);
  expect(pills.map(style => [style.minHeight, style.borderRadius, style.backgroundColor])).toEqual([[34, 17, "#F1E8E1"], [34, 17, "#5A4740"]]);
  const labels = choices().map(choice => choice.findAllByType("Text" as React.ElementType)[0].props.style.color);
  expect(labels).toEqual(["#2D2420", "#F8F3EE"]);
  expect(choices()[1].findAllByType("Icon" as React.ElementType)[0].props.name).toBe("help-circle-outline");
  const group = renderer!.root.findAllByType("View" as React.ElementType)
    .find(view => view.props.accessibilityRole === "radiogroup")!;
  expect(group.props.accessibilityLabel).toBe("Journal filters");
  // Large text scrolls in one row instead of stacking chips into a column.
  expect(group.props.style.flexDirection).toBe("row");
  expect(renderer!.root.findAllByType("ScrollView" as React.ElementType).filter(view => view.props.horizontal)).toHaveLength(1);
});

it("keeps fontVariant an array when a mounted number turns back into text", async () => {
  // React Native diffs a removed fontVariant to null, and processFontVariant(null) throws a render error.
  await mount(<Copy numeric>10 weeks old</Copy>);
  const variant = () => renderer!.root.findByType("Text" as React.ElementType).props.style.fontVariant;
  expect(variant()).toEqual(["tabular-nums"]);
  await act(async () => renderer!.update(<Copy>Today</Copy>));
  expect(variant()).toEqual([]);
});

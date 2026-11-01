import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dark, light } from "../constants/theme";
const f = vi.hoisted(() => ({ push: vi.fn(), report: vi.fn(), scheme: "light", keyboard: {} as Record<string, () => void> }));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", Text: "Text", Platform: { OS: "ios" },
  StyleSheet: { hairlineWidth: 0.33, create: (styles: object) => styles },
  Keyboard: { addListener: (name: string, listener: () => void) => { f.keyboard[name] = listener; return { remove() {} }; } } }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ router: { push: f.push } }));
vi.mock("@/lib/bottom-overlay", () => ({ reportTabScreenBottomInset: f.report }));
vi.mock("../components/design/foundation", () => ({ useColors: () => f.scheme === "dark" ? dark : light, haptics: { tick() {}, light() {} } }));
import { AppTabBar } from "../components/design/tab-bar";

let view: ReactTestRenderer | undefined;
const routes = ["train", "library", "discover", "progress", "search"].map(name => ({ key: `${name}-key`, name, params: undefined }));
const navigation = { emit: vi.fn(() => ({ defaultPrevented: false })), navigate: vi.fn() };
const render = (index = 1) => act(() => {
  view = create(createElement(AppTabBar, { state: { index, routes }, navigation, insets: { top: 0, right: 0, bottom: 34, left: 0 }, descriptors: {} } as never));
});
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); f.scheme = "light"; });
afterEach(() => { act(() => view?.unmount()); view = undefined; });

it("shows Today, Library, Add, Discover and Progress on a solid bar, never the hidden Search route", () => {
  render();
  const slots = view!.root.findAllByType("Pressable" as never);
  expect(slots.map(slot => slot.props.accessibilityLabel)).toEqual(["Today", "Library", "Add a workout", "Discover", "Progress"]);
  const bar = view!.root.findAllByType("View" as never)[0];
  expect(bar.props.style).toMatchObject({ backgroundColor: "#FFFFFF", borderTopWidth: 0.33, paddingBottom: 34 });
  f.scheme = "dark"; render();
  expect(view!.root.findAllByType("View" as never)[0].props.style.backgroundColor).toBe("#0C0C0C");
});

it("marks the selected tab with the accent and a tonal pill, and navigates on press", () => {
  render(1);
  const library = view!.root.findAllByType("Pressable" as never)[1];
  expect(library.props.accessibilityState).toEqual({ selected: true });
  expect(library.findAllByType("View" as never)[0].props.style[1]).toEqual({ backgroundColor: light.accentTint });
  expect(library.findByType("Icon" as never).props).toMatchObject({ name: "albums", color: light.accentText });
  const today = view!.root.findAllByType("Pressable" as never)[0];
  expect(today.findByType("Icon" as never).props).toMatchObject({ name: "today-outline", color: light.muted });
  act(() => today.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith("train", undefined);
  act(() => library.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledOnce();
});

it("opens Add from the centre slot and reports its height for toasts", () => {
  render();
  act(() => view!.root.findAllByType("Pressable" as never)[2].props.onPress());
  expect(f.push).toHaveBeenCalledWith("/add");
  act(() => view!.root.findAllByType("View" as never)[0].props.onLayout({ nativeEvent: { layout: { height: 90 } } }));
  expect(f.report).toHaveBeenCalledWith(90);
});

it("hides while the keyboard is up", () => {
  render();
  act(() => f.keyboard.keyboardWillShow());
  expect(view!.toJSON()).toBeNull();
  act(() => f.keyboard.keyboardWillHide());
  expect(view!.toJSON()).not.toBeNull();
});

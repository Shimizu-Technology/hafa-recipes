import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { light } from "../constants/theme";
const f = vi.hoisted(() => ({ reduced: false, timing: vi.fn() }));
vi.mock("react-native", () => {
  class Value { value: number; constructor(v: number) { this.value = v; } setValue(v: number) { this.value = v; } }
  return { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "Spinner", TextInput: "Input", InputAccessoryView: "Accessory", Keyboard: {},
    Platform: { OS: "ios" }, useWindowDimensions: () => ({ fontScale: 1 }), Easing: { bezier: () => "ease-out" },
    Animated: { Value, createAnimatedComponent: (c: unknown) => c, timing: (...args: unknown[]) => { f.timing(...args); return { start() {} }; } } };
});
vi.mock("../components/design/foundation", () => ({ Copy: "Copy", useColors: () => light, useSurface: () => "surface", useReducedMotion: () => f.reduced, haptics: { tick() {} } }));
vi.mock("../components/account-identity", () => ({ useAccountIdentity: () => ({}) }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("expo-image", () => ({ Image: "Image" }));
import { Button, Choice, Segmented, Field, Chip } from "../components/design/controls";
let view: ReactTestRenderer | undefined;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.reduced = false; f.timing.mockClear(); });
afterEach(() => { act(() => view?.unmount()); });
it("distinguishes exclusive radio choices from independent checkboxes", () => {
  act(() => { view = create(createElement(Choice, { label: "Ready", role: "radio", selected: true, onPress() {} })); });
  expect(view!.root.findByType("Pressable" as never).props).toMatchObject({ accessibilityRole: "radio", accessibilityState: { checked: true } });
  act(() => { view!.update(createElement(Choice, { label: "Consent", selected: false, onPress() {} })); });
  expect(view!.root.findByType("Pressable" as never).props.accessibilityRole).toBe("checkbox");
});
it("gives Choice opacity feedback without movement under Reduce Motion", () => {
  f.reduced = true;
  act(() => { view = create(createElement(Choice, { label: "Ready", selected: false, onPress() {} })); });
  const press = view!.root.findByType("Pressable" as never);
  press.props.onPressIn();
  expect(press.props.style.opacity.value).toBe(0.8);
  expect(press.props.style.transform[0].scale.value).toBe(1);
  press.props.onPressOut(); expect(press.props.style.opacity.value).toBe(1);
});
it("makes each segment responsive to press with its radio checked state", () => {
  act(() => { view = create(createElement(Segmented, { label: "Unit", value: "kg", options: [{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }], onChange() {} })); });
  const items = view!.root.findAllByType("Pressable" as never);
  expect(items.map(item => item.props.accessibilityState.checked)).toEqual([true, false]);
  items[1].props.onPressIn(); expect(f.timing).toHaveBeenCalled();
});
it("keeps disabled button text readable and explains a material blocker", () => {
  act(() => { view = create(createElement(Button, { title: "Log set", disabled: true, disabledReason: "Resume to log this set.", onPress() {} })); });
  const press = view!.root.findByType("Pressable" as never);
  expect(press.props.style.opacity.value).toBe(1);
  expect(press.props.accessibilityHint).toBe("Resume to log this set.");
  expect(view!.root.findAllByType("Copy" as never).map(item => item.props.children)).toContain("Resume to log this set.");
  expect(view!.root.findAllByType("Copy" as never)[0].props.color).toBe(light.text);
});

it("compact search keeps its accessible name without a duplicate visible label", async () => {
  await act(async () => { view = create(createElement(Field, { label: "Search Discover", hideLabel: true, value: "", onChange() {}, placeholder: "Search workouts or creators" })); });
  expect(view!.root.findByType("Input" as never).props.accessibilityLabel).toBe("Search Discover");
  expect(view!.root.findAllByType("Copy" as never)).toHaveLength(0);
});
it("exclusive people filters expose radio semantics and selected state", async () => {
  await act(async () => { view = create(createElement(Chip, { label: "Leon", role: "radio", selected: true, onPress() {} })); });
  const button = view!.root.findByType("Pressable" as never);
  expect(button.props.accessibilityRole).toBe("radio");
  expect(button.props.accessibilityState.checked).toBe(true);
});

it("exposes independent chips as checked controls in native and browser accessibility trees", () => {
  act(() => { view = create(createElement(Chip, { label: "Dumbbell", selected: true, onPress() {} })); });
  const chip = view!.root.findByType("Pressable" as never);
  expect(chip.props.accessibilityRole).toBe("checkbox");
  expect(chip.props.accessibilityState.checked).toBe(true);
  expect(chip.props["aria-checked"]).toBe(true);
  expect(chip.props["aria-pressed"]).toBeUndefined();
});

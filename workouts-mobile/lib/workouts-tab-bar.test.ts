import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ active: null as null | { workout: { title: string } }, push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Keyboard: { isVisible: () => false, addListener: () => ({ remove() {} }) } }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ router: { push: f.push } }));
vi.mock("expo-router/build/react-navigation/bottom-tabs", () => ({ BottomTabBar: "BottomTabBar" }));
vi.mock("@/lib/context", () => ({ useOfflineTraining: () => ({ state: { active: f.active } }) }));
vi.mock("@/components/design/foundation", () => ({ Copy: "Copy", useColors: () => ({}) }));
vi.mock("@/components/design/press", () => ({ animatedPressableComponent: () => "Pressable", usePressScale: () => ({ opacity: 1, scale: 1 }) }));
vi.mock("@/components/tab-chrome", () => ({ setTabOverlayHeight: vi.fn() }));
import { WorkoutsTabBar } from "@/components/workouts-tab-bar";
it("leaves browse content clear and keeps active training resumable", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const route of ["discover", "library", "extract", "train"]) {
    f.active = null;
    let tree: ReturnType<typeof create>;
    const props = { state: { index: 0, routes: [{ name: route }] } } as never;
    await act(async () => { tree = create(createElement(WorkoutsTabBar, props)); });
    expect(tree!.root.findAllByType("Pressable" as never)).toHaveLength(0);
    await act(async () => tree!.unmount());
  }
  f.active = { workout: { title: "Saved strength" } };
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(WorkoutsTabBar, { state: { index: 0, routes: [{ name: "library" }] } } as never)); });
  const resume = tree!.root.findByType("Pressable" as never);
  expect(resume.props.accessibilityLabel).toBe("Resume workout, Saved strength");
  await act(async () => resume.props.onPress());
  expect(f.push).toHaveBeenCalledWith("/training");
  await act(async () => tree!.unmount());
});

it("shows exactly one floating Resume on browse/Add and none on canonical Train", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.active = { workout: { title: "Current strength" } };
  for (const route of ["discover", "library", "extract", "train"]) {
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(WorkoutsTabBar, { state: { index: 0, routes: [{ name: route }] } } as never)); });
    const buttons = tree!.root.findAllByType("Pressable" as never);
    expect(buttons).toHaveLength(route === "train" ? 0 : 1);
    if (route !== "train") expect(buttons[0].props.accessibilityLabel).toBe("Resume workout, Current strength");
    await act(async () => tree!.unmount());
  }
});

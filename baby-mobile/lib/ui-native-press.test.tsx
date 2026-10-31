/// <reference types="node" />
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reduced: false, objectTransform: false, listener: null as null | ((v: boolean) => void) }));
vi.mock("react-native", async () => {
  const { createRequire } = await import("node:module"), { readFileSync, existsSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const require = createRequire(import.meta.url), React = require("react");
  const { transformSync } = require("@babel/core");
  const root = dirname(require.resolve("react-native/package.json"));
  const cache = new Map<string, any>();
  // Use locked RN createAnimatedComponent, AnimatedProps, style/transform nodes,
  // AnimatedValue and native transform validation. Only the bridge, native host,
  // animation clock and mounting adapter are replaced for this Node test.
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file).exports;
    if (file.includes("NativeAnimatedHelper")) return { API: new Proxy({}, { get: () => () => {} }),
      assertNativeAnimatedModule() {}, generateNewNodeTag: () => 1 };
    if (file.includes("ReactNativeFeatureFlags")) return new Proxy({}, {
      get: (_, key) => () => key === "shouldUseAnimatedObjectForTransform" ? state.objectTransform : false,
    });
    if (file.endsWith("/Utilities/Platform.js")) return { OS: "ios", select: (o: any) => o.ios ?? o.default };
    if (file.endsWith("/ReactNative/RendererProxy.js")) return { findNodeHandle: () => 1 };
    if (file.endsWith("/ReactPrivate/ReactNativePrivateInterface.js")) return { getNodeFromPublicInstance: () => null };
    if (file.includes("NativeAnimatedValidation")) return { validateStyles() {}, validateTransform() {} };
    if (file.endsWith("/AnimatedEvent.js")) return { AnimatedEvent: class {} };
    if (file.endsWith("/AnimatedInterpolation.js")) return class {};
    if (file.endsWith("/createAnimatedPropsHook.js")) return () => (props: any) => {
      const [, update] = React.useReducer((n: number) => n + 1, 0);
      const Props = load(resolve(root, "Libraries/Animated/nodes/AnimatedProps.js")).default;
      const node = React.useMemo(() => new Props(props, update), [props]);
      React.useLayoutEffect(() => { node.__attach(); return () => node.__detach(); }, [node]);
      return [node.__getValue(), () => {}];
    };
    const module = { exports: {} as any }; cache.set(file, module);
    const source = transformSync(readFileSync(file, "utf8"), { filename: file, babelrc: false, configFile: false,
      presets: [[require.resolve("@react-native/babel-preset"), { useTransformReactJSXExperimental: false }]] }).code;
    const localRequire = (name: string) => {
      if (!name.startsWith(".")) return require(name);
      let path = resolve(dirname(file), name);
      if (!path.endsWith(".js")) path += ".js";
      if (!existsSync(path) && existsSync(path.replace(/\.js$/, ".ios.js"))) path = path.replace(/\.js$/, ".ios.js");
      return load(path);
    };
    new Function("require", "module", "exports", "__DEV__", source)(localRequire, module, module.exports, true);
    return module.exports;
  }
  const createAnimatedComponent = load(resolve(root, "Libraries/Animated/createAnimatedComponent.js")).default;
  const Value = load(resolve(root, "Libraries/Animated/nodes/AnimatedValue.js")).default;
  const flatten = load(resolve(root, "Libraries/StyleSheet/flattenStyle.js")).default;
  const processTransform = load(resolve(root, "Libraries/StyleSheet/processTransform.js")).default;
  const Pressable = React.forwardRef((props: any, ref: any) => {
    const style = flatten(typeof props.style === "function" ? props.style({ pressed: false }) : props.style);
    if (style?.transform) processTransform(style.transform);
    return React.createElement("NativePressable", { ...props, ref, style });
  });
  const timing = (value: any, config: any) => ({ start: () => value.setValue(config.toValue) });
  return { View: "View", Text: "Text", Pressable, ScrollView: "ScrollView", TextInput: "TextInput",
    Platform: { OS: "ios" }, Keyboard: { dismiss() {} }, useColorScheme: () => "light",
    useWindowDimensions: () => ({ fontScale: 1 }),
    AccessibilityInfo: { isReduceMotionEnabled: async () => state.reduced,
      addEventListener: (_: string, cb: (v: boolean) => void) => { state.listener = cb; return { remove() {} }; } },
    Easing: { bezier: () => undefined }, Animated: { Value, createAnimatedComponent, timing,
      parallel: (animations: any[]) => ({ start: () => animations.forEach(a => a.start()) }) } };
});
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon", MaterialCommunityIcons: "Icon" }));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => {} }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("../components/brand-mark", () => ({ BrandMark: "BrandMark" }));
vi.mock("@/lib/input-purpose", () => ({ inputTraits: () => ({}) }));
import { PressTarget } from "../components/ui";
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it.each([false, true])("renders numeric native transforms through real RN Animated props (object transform=%s)", async objectTransform => {
  state.reduced = false; state.objectTransform = objectTransform;
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const ref = React.createRef<any>();
  await act(async () => { renderer = create(<PressTarget ref={ref} accessibilityRole="button"
    accessibilityLabel="Feed" accessibilityState={{ selected: true }}
    style={({ pressed }) => ({ minHeight: 44, backgroundColor: pressed ? "pressed" : "resting" })} />,
    { createNodeMock: element => ({ host: element.type }) }); });
  const host = () => renderer!.root.findByType("NativePressable" as React.ElementType);
  expect(host().props.style.transform).toEqual([{ scale: 1 }]);
  expect(host().props.accessibilityState).toEqual({ selected: true });
  expect(ref.current.host).toBe("NativePressable");
  await act(async () => host().props.onPressIn({}));
  expect(host().props.style.transform).toEqual([{ scale: 0.97 }]);
  expect(host().props.style.backgroundColor).toBe("pressed");
  await act(async () => host().props.onPressOut({}));
  expect(host().props.style.transform).toEqual([{ scale: 1 }]);
  await act(async () => state.listener!(true));
  await act(async () => host().props.onPressIn({}));
  expect(host().props.style.transform).toEqual([{ scale: 1 }]);
  expect(host().props.style.opacity).toBe(0.82);
  await act(async () => renderer!.update(<PressTarget ref={ref} disabled accessibilityLabel="Feed"
    style={({ pressed }) => ({ minHeight: 44, backgroundColor: pressed ? "pressed" : "resting" })} />));
  expect(host().props.disabled).toBe(true);
  expect(host().props.style).toMatchObject({ opacity: 0.5, minHeight: 44, backgroundColor: "resting", transform: [{ scale: 1 }] });
});

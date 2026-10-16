import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ platform: "ios", open: vi.fn(), close: vi.fn(), original: vi.fn(),
  background: null as null | ((state: string) => void), blur: null as null | (() => void) }));
vi.mock("react-native", () => ({ Modal: "Modal", View: "View", ScrollView: "ScrollView", ActivityIndicator: "Spinner",
  Platform: { get OS() { return f.platform; } }, Linking: { openURL: f.open },
  AppState: { addEventListener: (_event: string, listener: (state: string) => void) => {
    f.background = listener; return { remove() { f.background = null; } };
  } },
}));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return { useFocusEffect(callback: () => () => void) { useEffect(() => { const close = callback(); f.blur = close; return close; }, [callback]); } };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 16 }) }));
vi.mock("react-native-webview", () => ({ WebView: "WebView" }));
vi.mock("@/components/source-player", () => ({ SourcePlayerModal: "Player" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", Notice: "Notice", IconButton: "IconButton",
  useColors: () => ({ background: "background", action: "action" }), useReducedMotion: () => false,
}));
import { SourcePlayback } from "../components/source-playback";
import { SourcePlayerModal } from "../components/source-player.native";
import { sourcePlayer } from "./source-playback";
const url = "https://youtu.be/abcDEF_1234", player = sourcePlayer(url)!;
let tree: ReactTestRenderer | undefined;
const nodes = (type: string) => tree!.root.findAll(node => String(node.type) === type);
const button = (title: string) => nodes("Button").find(node => node.props.title === title)!;
async function mountCard(source = url) {
  await act(async () => { tree = create(createElement(SourcePlayback, { url: source, title: "Saved workout" })); });
}
async function click(title: string) { await act(async () => { button(title).props.onPress(); }); }
async function mountNative() {
  await act(async () => { tree = create(createElement(SourcePlayerModal, { player, title: "Saved workout", onClose: f.close, onOpenOriginal: f.original })); });
}
async function showPlayer() {
  await act(async () => {
    nodes("Modal")[0].props.onShow();
    nodes("View").find(node => node.props.testID === "player-stage")!.props.onLayout({ nativeEvent: { layout: { width: 360, height: 500 } } });
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.platform = "ios"; f.open.mockReset().mockResolvedValue(undefined); f.close.mockReset(); f.original.mockReset(); f.background = null; f.blur = null;
  vi.stubEnv("EXPO_PUBLIC_SOURCE_PLAYBACK_MODE", "embedded");
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.useRealTimers(); vi.unstubAllEnvs(); });

it("loads nothing until explicit intent, closes without navigating, and closes on route blur", async () => {
  await mountCard(); expect(nodes("Player")).toHaveLength(0);
  await click("Watch YouTube source"); expect(nodes("Player")).toHaveLength(1);
  await act(async () => { nodes("Player")[0].props.onClose(); }); expect(nodes("Player")).toHaveLength(0);
  await click("Watch YouTube source"); await act(async () => { f.blur!(); }); expect(nodes("Player")).toHaveLength(0);
  expect(f.open).not.toHaveBeenCalled();
});
it("does not carry playback intent to a different source URL", async () => {
  await mountCard(); await click("Watch YouTube source");
  await act(async () => { tree!.update(createElement(SourcePlayback, { url: "https://youtu.be/different12", title: "Other workout" })); });
  expect(nodes("Player")).toHaveLength(0);
});
it.each(["https://instagram.com/reel/Example_42/", "https://example.test/workout"])("opens %s outside the app without embedding", async source => {
  await mountCard(source); expect(nodes("Player")).toHaveLength(0);
  expect(nodes("Button")).toHaveLength(1); await click("Open original source"); expect(f.open).toHaveBeenCalledWith(source);
});
it.each(["web", "external"])("keeps the original available for %s playback", async mode => {
  if (mode === "web") f.platform = "web"; else vi.stubEnv("EXPO_PUBLIC_SOURCE_PLAYBACK_MODE", "external");
  await mountCard(); expect(button("Watch YouTube source")).toBeUndefined(); await click("Open original source"); expect(f.open).toHaveBeenCalledWith(url);
});
it("keeps a failed original-source action recoverable", async () => {
  f.open.mockRejectedValueOnce(Error("Unavailable")); await mountCard(); await click("Open original source");
  expect(nodes("Notice")[0].props.children).toContain("Could not open the original source");
  await click("Open original source"); expect(f.open).toHaveBeenCalledTimes(2);
});
it("mounts the native player only after presentation and confines its URLs, popups and media permissions", async () => {
  await mountNative(); expect(nodes("WebView")).toHaveLength(0); await showPlayer();
  const props = nodes("WebView")[0].props;
  expect(props.source.uri).toContain("autoplay=0"); expect(props.mediaPlaybackRequiresUserAction).toBe(true);
  expect(props.mediaCapturePermissionGrantType).toBe("deny"); expect(props.allowFileAccess).toBe(false);
  expect(props.onShouldStartLoadWithRequest({ url: player.embedUrl })).toBe(true);
  expect(props.onShouldStartLoadWithRequest({ url: "https://example.test" })).toBe(false);
  props.onOpenWindow({ nativeEvent: { targetUrl: "https://example.test" } }); expect(f.open).not.toHaveBeenCalled();
  await act(async () => { props.onError(); props.onLoadEnd(); });
  expect(nodes("WebView")).toHaveLength(0); expect(button("Open original source")).toBeDefined();
  await click("Try player again"); expect(nodes("WebView")).toHaveLength(1);
});
it("offers fallback after the load timeout and tears down the background listener", async () => {
  vi.useFakeTimers(); await mountNative(); await showPlayer();
  await act(async () => { vi.advanceTimersByTime(15001); });
  expect(nodes("WebView")).toHaveLength(0); expect(button("Try player again")).toBeDefined();
  await click("Open original source"); expect(f.original).toHaveBeenCalledOnce();
  await act(async () => { f.background!("inactive"); }); expect(f.close).not.toHaveBeenCalled();
  await act(async () => { f.background!("background"); }); expect(f.close).toHaveBeenCalledOnce();
  await act(async () => { tree!.unmount(); }); tree = undefined; expect(f.background).toBeNull();
});

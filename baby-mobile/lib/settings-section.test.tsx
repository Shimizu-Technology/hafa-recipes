import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ section: undefined as string | undefined, scroll: vi.fn() }));
vi.mock("react-native", () => ({ Alert: {}, Linking: {}, ScrollView: "ScrollView", View: "View" }));
vi.mock("expo-router", () => ({ router: {}, useLocalSearchParams: () => ({ section: f.section }) }));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("@/lib/share-session-state", () => ({ revokeShareSession() {} }));
vi.mock("@/lib/account-deletion", () => ({ confirmAccountDeletion() {} }));
vi.mock("@/lib/files", () => ({ exportFile() {} }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { outbox: [], bootstrap: { profile: { display_name: "Parent" }, children: [] } } }) }));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Grouped: "Grouped", Notice: "Notice", Row: "Row", Section: "Section", useToast: () => () => {},
  Screen: (props: any) => { props.scrollRef.current = { scrollTo: f.scroll }; return React.createElement("scroll-screen", props); },
}));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
import Settings from "../app/settings";
let view: ReactTestRenderer;
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); f.scroll.mockClear(); });
afterEach(() => { act(() => view.unmount()); vi.unstubAllGlobals(); });
it.each([undefined, "ai"])("scrolls only AI deep links after both layout and content are ready (%s)", async section => {
  f.section = section;
  await act(async () => { view = create(<Settings />); });
  expect(f.scroll).not.toHaveBeenCalled();
  await act(async () => view.root.findByType("View" as React.ElementType).props.onLayout({ nativeEvent: { layout: { y: 620 } } }));
  expect(f.scroll).not.toHaveBeenCalled();
  await act(async () => view.root.findByType("scroll-screen" as React.ElementType).props.onContentReady());
  if (section === "ai") expect(f.scroll).toHaveBeenCalledWith({ y: 620, animated: false });
  else expect(f.scroll).not.toHaveBeenCalled();
});

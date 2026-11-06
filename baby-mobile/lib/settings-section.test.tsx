import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ section: undefined as string | undefined, scroll: vi.fn(), bootstrap: {} as object, ask: null as number | null }));
vi.mock("react-native", () => ({ Alert: {}, Linking: {}, ScrollView: "ScrollView", View: "View" }));
vi.mock("expo-router", () => ({ router: {}, useLocalSearchParams: () => ({ section: f.section }) }));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("@/lib/share-session-state", () => ({ revokeShareSession() {} }));
vi.mock("@/lib/account-deletion", () => ({ confirmAccountDeletion() {} }));
vi.mock("@/lib/files", () => ({ exportFile() {} }));
vi.mock("@/lib/ai-consent", () => ({ ASK_CONSENT_BODY: "NEW ASK WORDS", ASK_UPDATE_TITLE: "", acknowledgeAsk: vi.fn(), needsAskAcknowledgment: () => false }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { outbox: [], bootstrap: { ask_consent_version: f.ask, profile: { display_name: "Parent" }, children: [], ...f.bootstrap } } }) }));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Grouped: "Grouped", Notice: "Notice", Row: "Row", Section: "Section", useToast: () => () => {},
  Screen: (props: any) => { props.scrollRef.current = { scrollTo: f.scroll }; return React.createElement("scroll-screen", props); },
}));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/child-setup", () => ({ babyDetailLine() {} }));
import Settings from "../app/settings";
let view: ReactTestRenderer;
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); f.scroll.mockClear(); f.bootstrap = {}; });
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
it.each([
  ["the flag off", {}, false],
  ["the flag on", { spaces: [{ id: "p", kind: "personal" }] }, true],
  ["this account off the rehearsal's list", { spaces: [{ id: "p", kind: "personal" }], family_available: false }, false],
  ["a family, whatever the list says", { spaces: [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "parent" }], family_available: false }, true],
])("offers the Family row rightly with %s", async (_, bootstrap, shown) => {
  f.bootstrap = bootstrap; f.section = undefined;
  await act(async () => { view = create(<Settings />); });
  expect(view.root.findAll((n) => String(n.type) === "Row" && n.props.title === "Family").length).toBe(shown ? 1 : 0);
});
it.each([[null, false], [1, true]])("with the new Ask at version %s, Settings shows its disclosure: %s", async (version, shown) => {
  f.section = undefined; f.ask = version;
  await act(async () => { view = create(<Settings />); });
  const words = view.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => [n.props.children].flat().join(" ")).join(" ");
  expect(words.includes("NEW ASK WORDS")).toBe(shown);
  expect(words.includes("relevant authorized Baby records")).toBe(!shown);
  f.ask = null;
});

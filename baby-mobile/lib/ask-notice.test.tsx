import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../components/health-note", () => ({ HealthNote: "HealthNote" }));

const scope = vi.hoisted(() => ({ push: vi.fn(), fontScale: 1,
  baby: { state: { bootstrap: { ai_available: false, children: [], profile: { ai_consent: false } } }, records: [], commit: vi.fn(async () => undefined), sync: vi.fn() },
  chat: { question: "", messages: [] as { role: string; content: string; help?: string }[], context: { scope: "all" }, history: [], showHistory: false, busy: false, resolving: false, error: "" },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Text: "Text", TextInput: "TextInput", View: "View",
  useWindowDimensions: () => ({ fontScale: scope.fontScale, height: 800 }),
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, router: { push: scope.push }, useFocusEffect: () => undefined, useLocalSearchParams: () => ({}) }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.baby }));
vi.mock("../components/ask-answer", () => ({ AnswerText: "AnswerText", WebSources: "WebSources" }));
vi.mock("../components/ask-history", () => ({ AskHistory: "AskHistory" }));
vi.mock("@/lib/care-format", () => ({ friendlyDate: (value: string) => value }));
vi.mock("@/lib/ai-consent", () => ({ ASK_UPDATE_TITLE: "Ask can now do more", acknowledgeAsk: vi.fn(), needsAskAcknowledgment: () => false }));
vi.mock("@/lib/chat-citations", () => ({ citationExcerpt: () => "", readableCitations: (text: string) => text }));
vi.mock("@/components/record-row", () => ({ kindIcon: {} }));
vi.mock("@/lib/models", () => ({ kindName: {} }));
vi.mock("@/lib/use-ask-session", () => ({ useAskSession: () => scope.chat }));
vi.mock("../components/tab-stack", () => ({ HeaderIconButton: "HeaderIconButton", HeaderPill: "HeaderPill", TabActions: "TabActions", headerActions: () => ({}) }));
vi.mock("@/components/ui", () => ({
  Button: "Button", HeaderAction: "HeaderAction", Card: "Card", FilterChips: "FilterChips", Copy: "Copy", Grouped: "Grouped",
  Icon: "Icon", Loading: "Loading", Notice: "Notice", PressTarget: "PressTarget", Row: "Row", Screen: ({ children, footer, ...props }: { children?: React.ReactNode; footer?: React.ReactNode; [key: string]: unknown }) => React.createElement("Screen", props, children, footer), Section: "Section",
  fonts: { semibold: "semibold" }, radii: { notice: 20 }, useColors: () => ({ tile: "tile", accentText: "clay", muted: "muted" }),
}));
import AskScreen, { AiNotice, AskUpdateNotice, CantAnswer } from "../components/ask-screen";

let renderer: ReactTestRenderer | undefined;
const copy = () => renderer!.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children);
const review = () => renderer!.root.findAll((n) => n.props.accessibilityLabel === "Review AI permission");
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); scope.push.mockClear(); scope.fontScale = 1; scope.chat.messages = []; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("says AI is off in one line, keeps other apps' data out, and links to the permission", async () => {
  await act(async () => { renderer = create(<AiNotice service consent={false} />); });
  expect(copy()).toEqual(["AI is off. Ask uses your Baby entries only, never Recipes or Workouts."]);
  expect(review()).toHaveLength(1);
  await act(async () => review()[0].props.onPress());
  expect(scope.push).toHaveBeenCalledWith({ pathname: "/settings", params: { section: "ai" } });
});
it("explains an unavailable service without sending her to Settings when consent is already given", async () => {
  await act(async () => { renderer = create(<AiNotice service={false} consent />); });
  expect(copy()).toEqual(["AI isn’t available on this service yet. Saved, Journal and care logs still work."]);
  expect(review()).toHaveLength(0);
});
it("stacks the link under the line at large text sizes", async () => {
  scope.fontScale = 2;
  await act(async () => { renderer = create(<AiNotice service consent={false} />); });
  expect(renderer!.root.findAll((n) => (n.type as unknown) === "View")[0].props.style).toMatchObject({ flexDirection: "column" });
});

it("offers the new Ask in one line, and only Review acts", async () => {
  const onReview = vi.fn();
  await act(async () => { renderer = create(<AskUpdateNotice onReview={onReview} />); });
  expect(copy().join(" ")).toMatch(/search trusted sites online/);
  expect(onReview).not.toHaveBeenCalled();
  renderer!.root.findAll((n) => n.props.accessibilityLabel === "Review what Ask can do")[0].props.onPress();
  expect(onReview).toHaveBeenCalledTimes(1);
});

it("says where to go whenever Ask can't answer", async () => {
  await act(async () => { renderer = create(<CantAnswer error="Håfa Baby could not save this change." />); });
  expect(renderer!.root.findAll((n) => (n.type as unknown) === "Notice")[0].props.children).toBe("Håfa Baby could not save this change.");
  expect(copy()).toEqual(["If this might be urgent, open Help or call 911."]);
  const help = renderer!.root.findAll((n) => (n.type as unknown) === "Button")[0];
  expect(help.props.title).toBe("Open Help");
  await act(async () => help.props.onPress());
  expect(scope.push).toHaveBeenCalledWith("/help");
});


it("keeps the actual urgent answer and Help free of status and disclosure at largest text", async () => {
  scope.fontScale = 3.1;
  scope.chat.messages = [{ role: "user", content: "My baby is not breathing" }, { role: "assistant", content: "Call 911 now. Your baby may be having a life-threatening emergency.", help: "baby_unwell" }];
  await act(async () => { renderer = create(<AskScreen />); });
  const tree = JSON.stringify(renderer!.toJSON());
  expect(tree).toContain("Call 911 now.");
  expect(tree.indexOf("Open Help")).toBeLessThan(tree.indexOf("Call 911 now."));
  expect(renderer!.root.findAllByType(AiNotice)).toHaveLength(0);
  expect(tree).not.toContain("HealthNote");
  expect(renderer!.root.findByType("TextInput" as never).props.placeholder).toBe("Question");
});

it("uses short status wording at largest text before a question", async () => {
  scope.fontScale = 3.1;
  await act(async () => { renderer = create(<AiNotice service={false} consent={false} />); });
  expect(copy()).toEqual(["AI unavailable. Urgent? Open Help."]);
});

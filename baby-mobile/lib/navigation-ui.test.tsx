import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  fontScale: 1, ask: {} as any, keyboard: {} as Record<string, () => void>, removed: [] as string[],
  params: {} as Record<string, string>, stack: [] as any[], baby: null as any, views: [] as any[], picker: null as any, toasts: [] as any[],
}));
vi.mock("@/lib/weekly-content", () => import("./weekly-content"));
vi.mock("@/lib/share-session-state", () => ({ revokeShareSession: vi.fn() }));
vi.mock("@/lib/account-deletion", () => ({ confirmAccountDeletion: vi.fn() }));
vi.mock("react-native", () => ({
  RefreshControl: "RefreshControl", View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput",
  ActivityIndicator: "ActivityIndicator", InputAccessoryView: "InputAccessoryView", KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" }, Keyboard: { dismiss: vi.fn(), addListener: (event: string, fn: () => void) => { mock.keyboard[event] = fn; return { remove() { mock.removed.push(event); } }; } }, Alert: { alert: vi.fn() },
  useColorScheme: () => "light", useWindowDimensions: () => ({ fontScale: mock.fontScale, height: 844 }),
  AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove() {} }) },
  Easing: { bezier: vi.fn() }, Animated: {
    Value: class { setValue() {} stopAnimation() {} }, createAnimatedComponent: () => "AnimatedPressable",
    timing: () => ({}), parallel: () => ({ start() {} }),
  },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon", MaterialCommunityIcons: "CareIcon" }));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => {} }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("expo-router", () => ({
  Stack: { Screen: ({ options }: any) => options?.headerRight?.() ?? options?.unstable_headerRightItems?.()[0]?.element ?? null },
  useLocalSearchParams: () => mock.params,
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  router: {
    push: (route: any) => { mock.stack.push(route); mock.params = route.params ?? {}; },
    canGoBack: () => mock.stack.length > 1,
    back: () => { mock.stack.pop(); mock.params = mock.stack.at(-1)?.params ?? {}; },
    replace: (route: any) => { mock.stack[mock.stack.length - 1] = route; },
  },
}));
vi.mock("../components/brand-mark", () => ({ BrandMark: "BrandMark" }));
vi.mock("@/lib/input-purpose", () => ({ inputTraits: () => ({}) }));
vi.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true, NavigationContext: React.createContext(undefined) }));
vi.mock("@/lib/ask-sources", async () => await import("./ask-sources"));
vi.mock("@/lib/models", async () => await import("./models"));
vi.mock("@/lib/ai-consent", () => ({ ASK_CONSENT_BODY: "", ASK_UPDATE_TITLE: "", acknowledgeAsk: vi.fn(), needsAskAcknowledgment: () => false, ensureAiConsent: async () => true }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/components/child-filter", () => ({ ChildFilter: () => null }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: () => null }));
vi.mock("@/components/motion", () => ({ Swell: ({ children }: { children: React.ReactNode }) => children, FadeUp: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/record-row", () => ({ RecordRow: "RecordRow", kindIcon: {} }));
vi.mock("@/components/private-attachment", () => ({ PrivateAttachment: "PrivateAttachment" }));
vi.mock("@/components/share-toggle", () => ({ ShareToggle: () => null }));
vi.mock("@/components/source-content", () => ({ SourceContent: "SourceContent" }));
vi.mock("@/lib/use-ask-session", () => ({ useAskSession: (record_id: string) => ({
  context: { scope: "all", record_id, child_id: null }, focusedTitle: "Saved source", question: "", messages: [],
  history: [], showHistory: false, resolving: false, busy: false, error: "", openHistory() {}, ...mock.ask,
}) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/history", () => import("./history"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/components/more-logs", () => ({ MoreLogs: () => null }));
vi.mock("@/lib/chat-citations", () => import("./chat-citations"));
vi.mock("@/components/header-search", () => import("../components/header-search"));
vi.mock("@/components/tab-stack", () => import("../components/tab-stack"));
vi.mock("@/components/ui", async () => ({ ...(await import("../components/ui")), useToast: () => (message: string, action?: unknown) => mock.toasts.push([message, action]) }));
vi.mock("@/components/disclosure", () => import("../components/disclosure"));
vi.mock("./ai-consent", () => ({ ensureAiConsent: async () => true }));
vi.mock("@/components/ask-screen", () => import("../components/ask-screen"));
vi.mock("@/components/visit-sections", () => ({ LinkQuestions: "LinkQuestions", RecordVisit: "RecordVisit" }));
vi.mock("@/lib/source-title", () => import("./source-title"));
vi.mock("@/lib/use-library-history", () => ({ useLibraryHistory: (view: { kind: string }) => (mock.views.push(view), {
  rows: mock.baby.records.filter((record: any) => record.kind === view.kind), loading: false, error: "", more: false,
  refresh: () => {}, loadMore: async () => {},
}) }));
vi.mock("@/lib/categories", () => import("./categories"));
vi.mock("@/components/category-picker", () => ({ CategoryPicker: (props: any) => (mock.picker = props, null) }));
vi.mock("@/components/import-updates", () => ({ ImportUpdates: () => null }));
vi.mock("@/components/tips", () => import("../components/tips"));
vi.mock("@/components/timing-editor", () => import("../components/timing-editor"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/suggestions", () => import("./suggestions"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/components/saved-post-row", () => import("../components/saved-post-row"));
vi.mock("@/components/source-recovery", () => import("../components/source-recovery"));
vi.mock("@/lib/spaces", () => import("./spaces"));
import Library from "../app/(tabs)/library";
import Journal, { JournalContent } from "../app/journal";
import RecordDetail from "../app/record/[id]";
import { Grouped, Screen } from "../components/ui";
import AskEntry from "../app/ask-entry";
import { ApiError } from "./api";
import { emptyState, optimisticRecord } from "./models";
import { getDockedFooterHeight } from "./bottom-overlay";
let renderer: ReactTestRenderer | undefined;
const row = (id: string, kind: "journal" | "feeding" | "question" | "source" | "sleep") => optimisticRecord({
  id, kind, title: id, body: `Observation ${id}`, child_id: null, data: {}, occurred_at: "2026-10-30T00:00:00Z",
});
async function mount(element: React.ReactElement) { await act(async () => { renderer = create(element); }); }
async function press(label: string) {
  const target = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType)
    .find(n => n.props.accessibilityLabel === label || n.props.accessibilityLabel?.startsWith(label + ". "));
  expect(target, label).toBeDefined();
  await act(async () => target!.props.onPress());
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.params = {}; mock.stack = []; mock.views = []; mock.picker = null; mock.toasts = [];
  mock.fontScale = 1; mock.ask = {}; mock.keyboard = {}; mock.removed = [];
  const records = [row("Journal observation", "journal"), row("Bottle observation", "feeding"), row("Doctor question", "question"), row("Saved source", "source")];
  mock.baby = {
    owner: "owner", records, online: true, current: () => true,
    state: { ...emptyState(), records, bootstrap: { generation: 1, children: [], profile: { timezone: "Pacific/Guam", ai_consent: true }, ai_available: true } },
    api: { lease: () => 1, assertLease() {}, records: async ({ kinds }: any) => ({ items: records.filter(r => kinds.includes(r.kind)), total: records.length, has_more: false }) },
    commit: async () => {},
  };
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it("reads a sleep's times on the family's clock, as Tracker does", async () => {
  const sleep = { ...row("nap", "sleep"), data: { end_at: "2026-10-30T01:00:00Z" } };
  mock.baby.records = [sleep];
  mock.baby.state = { ...mock.baby.state, records: [sleep], bootstrap: { ...mock.baby.state.bootstrap, profile: { timezone: "Pacific/Kiritimati", ai_consent: true } } };
  mock.params = { id: "nap" };
  await mount(<RecordDetail />);
  const texts = renderer!.root.findAll((n) => n.props?.numeric === true).map((n) => [n.props.children].flat().join("")).join(" | ");
  expect(texts).toMatch(/Started.*2:00\sPM/);
  expect(texts).toMatch(/Ended.*3:00\sPM/);
});
it("sends Doctor questions to the one-page summary, for the selected baby", async () => {
  mock.params = { filter: "question" };
  await mount(<Journal />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  await press("Doctor summary");
  expect(mock.stack.at(-1)!.pathname).toBe("/doctor-summary");
  expect(renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.kind)).toEqual(["question"]);
});
describe("an entry that goes away while it's open", () => {
  const titled = () => renderer!.root.findAll((n) => typeof n.props.title === "string").map((n) => n.props.title);
  const said = () => renderer!.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children).join(" | ");
  it("says so, instead of opening it forever, when the other parent makes it private", async () => {
    mock.params = { id: "Saved source" };
    await mount(<RecordDetail />);
    mock.baby.api.record = vi.fn(async () => { throw new ApiError("Item unavailable", 404); });
    mock.baby.records = mock.baby.records.filter((r: { id: string }) => r.id !== "Saved source");
    await act(async () => renderer!.update(<RecordDetail />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(mock.baby.api.record).toHaveBeenCalledWith("Saved source");
    expect(titled()).toContain("Entry unavailable");
    expect(titled()).not.toContain("Opening your entry");
    expect(said()).toMatch(/isn’t here any more/);
    expect(said()).not.toMatch(/local copy/);
  });
  it("stays unavailable when Try again gets the same answer", async () => {
    mock.params = { id: "Gone" };
    mock.baby.api.record = vi.fn(async () => { throw new ApiError("Item unavailable", 404); });
    await mount(<RecordDetail />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    await press("Try again");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(mock.baby.api.record).toHaveBeenCalledTimes(2);
    expect(titled()).toContain("Entry unavailable");
    expect(said()).toMatch(/isn’t here any more/);
  });
});
it.each(["personal", "family"])("Ask says which Nora a %s conversation is for", async (which) => {
  const b = mock.baby.state.bootstrap;
  mock.baby.state = { ...mock.baby.state, bootstrap: { ...b, personal_space_id: "p", spaces: [{ id: "p", kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: "f", kind: "family", role: "parent", generation: 1, access_version: 1 }],
    children: [{ id: "personal", name: "Nora", space_id: "p" }, { id: "family", name: "Nora", space_id: "f" }] } };
  mock.ask = { context: { scope: "all", record_id: null, child_id: which } };
  await mount(<AskEntry />);
  const said = renderer!.root.findAllByType("Text" as React.ElementType).map((n) => [n.props.children].flat().join("")).join(" | ");
  expect(said).toContain(which === "personal" ? "Nora · Personal" : "Nora · Family");
});
describe("signing out from the recovery screen", () => {
  it("says what it would clear before it does, and the screen stays if she says no", async () => {
    const { AccountGate } = await import("../components/account-gate");
    const { Alert } = await import("react-native");
    mock.baby.ready = false; mock.baby.error = "Private device data needs recovery. It has not been overwritten."; mock.baby.signOut = vi.fn(async () => undefined);
    await mount(<AccountGate>inside</AccountGate>);
    await press("Sign out");
    expect(mock.baby.signOut).not.toHaveBeenCalled();
    const [title, message, buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)! as [string, string, { text: string; onPress?: () => void }[]];
    expect(`${title} ${message}`).toMatch(/haven’t sent/);
    expect(`${title} ${message}`).toMatch(/Update/);
    await act(async () => buttons.find((one) => one.text === "Sign out and clear")!.onPress!());
    expect(mock.baby.signOut).toHaveBeenCalledOnce();
  });
  it("is one tap on an ordinary failure, with nothing to lose", async () => {
    const { AccountGate } = await import("../components/account-gate");
    mock.baby.ready = false; mock.baby.error = "Could not connect."; mock.baby.signOut = vi.fn(async () => undefined);
    await mount(<AccountGate>inside</AccountGate>);
    await press("Sign out");
    expect(mock.baby.signOut).toHaveBeenCalledOnce();
  });
});
describe("a caregiver and Ask", () => {
  const caregiver = () => { mock.baby.state = { ...mock.baby.state, bootstrap: { ...mock.baby.state.bootstrap, spaces: [{ id: "own", kind: "personal", role: "owner" }, { id: "fam", kind: "family", role: "caregiver" }] } }; };
  const said = () => renderer!.root.findAll((n) => typeof n.props.children === "string" || typeof n.props.title === "string").map((n) => n.props.title ?? n.props.children).join(" | ");
  it("isn't offered Ask on an entry", async () => {
    caregiver();
    mock.params = { id: "Saved source" };
    await mount(<RecordDetail />);
    expect(said()).not.toContain("Ask about this entry");
    expect(said()).toContain("Edit this entry");
  });
  it("gets a plain explanation if a link lands on it, without opening a chat", async () => {
    caregiver();
    let asked = 0;
    mock.ask = { get question() { asked += 1; return ""; } };
    mock.params = { record_id: "Saved source" };
    await mount(<AskEntry />);
    expect(said()).toMatch(/caregiver/i);
    expect(said()).toMatch(/kept/i);
    expect(said()).not.toContain("Ask about this");
    expect(asked).toBe(0);
    expect(renderer!.root.findAllByType("TextInput" as React.ElementType)).toHaveLength(0);
  });
  it("gets Ask back with no change for a parent", async () => {
    mock.baby.state = { ...mock.baby.state, bootstrap: { ...mock.baby.state.bootstrap, spaces: [{ id: "own", kind: "personal", role: "owner" }, { id: "fam", kind: "family", role: "parent" }] } };
    mock.params = { record_id: "Saved source" };
    await mount(<AskEntry />);
    expect(said()).toContain("Ask about this");
  });
});
it("pushes focused Ask from a saved entry and its real Back control returns to that entry", async () => {
  mock.params = { id: "Saved source" };
  mock.stack = [{ pathname: "/(tabs)/library" }, { pathname: "/record/[id]", params: mock.params }];
  await mount(<RecordDetail />);
  await press("Ask about this entry");
  expect(mock.stack.at(-1)).toEqual({ pathname: "/ask-entry", params: { record_id: "Saved source" } });
  await act(async () => renderer!.update(<AskEntry />));
  expect(renderer!.root.findAllByType("Text" as React.ElementType).some(n => n.props.children === "Ask about this")).toBe(true);
  await press("Go back");
  expect(mock.stack.at(-1)).toEqual({ pathname: "/record/[id]", params: { id: "Saved source" } });
});

it("keeps compact Journal filters horizontal and writing-only", async () => {
  mock.params = { filter: "all" };
  await mount(<Journal />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.kind)).toEqual(["journal", "question"]);
  expect(renderer!.root.findAllByType("ScrollView" as React.ElementType).some(n => n.props.horizontal)).toBe(true);
});
it("opens Journal as a pushed screen with Back and Write, and old filtered links keep working", async () => {
  mock.stack = [{ pathname: "/(tabs)/(today)" }, { pathname: "/journal", params: { filter: "question", at: "1" } }];
  mock.params = { filter: "question", at: "1" };
  await mount(<Journal />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(renderer!.root.findByType(Screen).props.back).toBe(true);
  expect(renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.kind)).toEqual(["question"]);
  await press("Write");
  expect(mock.stack.at(-1)).toEqual({ pathname: "/edit", params: { kind: "question" } });
});
it("keeps care-only history pushed with Back and disclosed care search", async () => {
  mock.stack = [{ pathname: "/(tabs)" }, { pathname: "/care-history" }];
  await mount(<JournalContent careHistory />);
  expect(renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.kind)).toEqual(["feeding"]);
  expect(renderer!.root.findAllByType("TextInput" as React.ElementType)).toHaveLength(0);
  await press("Search");
  expect(renderer!.root.findByType("TextInput" as React.ElementType).props.placeholder).toBe("Search care logs");
  await press("Go back");
  expect(mock.stack.at(-1)).toEqual({ pathname: "/(tabs)" });
});

it("keeps untitled sources distinguishable when selecting posts for categories", async () => {
  const record = mock.baby.records.find((entry: any) => entry.kind === "source");
  record.title = "Saved source";
  record.body = "Pack spare diapers before leaving home. A second sentence stays in the original.";
  await mount(<Library />);
  await press("Select");
  const choices = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType)
    .filter(node => node.props.accessibilityRole === "checkbox");
  expect(choices.map(node => node.props.accessibilityLabel)).toEqual(["Pack spare diapers before leaving home."]);
  expect(record.title).toBe("Saved source");
});

it("shows completed sleep start, end and duration with rounded numeric text", async () => {
  const sleep = { ...row("Nap", "sleep"), occurred_at: "2026-10-30T00:00:00Z", data: { end_at: "2026-10-30T01:30:00Z" } };
  mock.baby.records.push(sleep); mock.params = { id: "Nap" };
  await mount(<RecordDetail />);
  expect(renderer!.root.findByType(Screen).props.numericSubtitle).toBe(true);
  const text = renderer!.root.findAllByType("Text" as React.ElementType);
  const duration = text.find(t => t.props.children === "1 h 30 min")!;
  expect(duration.props.style.fontVariant).toEqual(["tabular-nums"]);
  expect(text.some(t => JSON.stringify(t.props.children).includes("Started"))).toBe(true);
  expect(text.some(t => JSON.stringify(t.props.children).includes("Ended"))).toBe(true);
});
it.each([false, true])("keeps Ask following messages or pending response (busy=%s), with readable large input", async busy => {
  mock.fontScale = 1.5;
  mock.ask = { busy, messages: busy ? [] : [{ role: "user", content: "Find my packing list" }], showHistory: false,
    history: [{ id: "conversation", title: "Packing notes", updated_at: "2026-10-30T01:30:00Z" }] };
  await mount(<AskEntry />);
  expect(renderer!.root.findByType(Screen).props.followEnd).toBe(true);
  expect(renderer!.root.findByType("TextInput" as React.ElementType).props.placeholder).toBe("Question");
  if (!busy) expect(renderer!.root.findAllByType("Text" as React.ElementType).find(t => t.props.children === "Find my packing list")!.props.style.lineHeight).toBe(22);
});
it("keeps the focused entry notice at the top while its context is resolving", async () => {
  mock.params = { record_id: "source" };
  mock.ask = { busy: true, resolving: true };
  await mount(<AskEntry />);
  expect(renderer!.root.findByType(Screen).props.followEnd).toBe(false);
  expect(renderer!.root.findAllByType("Text" as React.ElementType).some(t =>
    t.props.children === "Questions use this saved entry and its own child profile, including general entries.")).toBe(true);
});
it("has no scope chips, and keeps New chat beside History in every state", async () => {
  const startNew = vi.fn();
  for (const ask of [{}, { messages: [{ role: "user", content: "Earlier" }] }, { showHistory: true }, { context: { scope: "all", record_id: "entry", child_id: null } }]) {
    mock.ask = { startNew, ...ask };
    await mount(<AskEntry />);
    const targets = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType);
    expect(targets.filter(n => n.props.accessibilityRole === "radio")).toEqual([]);
    expect(targets.some(n => n.props.accessibilityLabel === "New chat")).toBe(true);
    expect(targets.some(n => n.props.accessibilityLabel === ("showHistory" in ask ? "Done" : "History"))).toBe(true);
    act(() => renderer!.unmount());
  }
  mock.ask = { startNew };
  await mount(<AskEntry />);
  await press("New chat");
  expect(startNew).toHaveBeenCalledOnce();
});
it("reaches Help from Ask's header, in one tap", async () => {
  await mount(<AskEntry />);
  await press("Help");
  expect(mock.stack.at(-1)).toBe("/help");
});
it("keeps New chat from interrupting an answer on its way", async () => {
  mock.ask = { busy: true, startNew: vi.fn() };
  await mount(<AskEntry />);
  expect(renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).find(n => n.props.accessibilityLabel === "New chat")!.props.disabled).toBe(true);
});
it("still asks about one entry from a focused screen", async () => {
  mock.ask = { context: { scope: "all", record_id: "entry", child_id: null }, focusedTitle: "Packing video" };
  await mount(<AskEntry />);
  const text = () => renderer!.root.findAllByType("Text" as React.ElementType).map(t => t.props.children);
  expect(text()).toContain("Ask about this");
  expect(text()).toContain("Packing video");
});
it("shows the reminder about sources under the first answer only, and remembers it", async () => {
  const notice = /are different sources/;
  const shown = () => renderer!.root.findAllByType("Text" as React.ElementType).some(t => notice.test(String([t.props.children].flat().join(" "))));
  const commit = vi.fn(async (change: (state: any) => any) => { mock.baby.state = change(mock.baby.state); });
  mock.baby = { ...mock.baby, commit };
  const answer = [{ role: "user", content: "Q" }, { role: "assistant", content: "A", citations: [] }];
  mock.ask = { messages: [{ role: "user", content: "Q" }] };
  await mount(<AskEntry />);
  expect(shown()).toBe(false);
  mock.ask = { messages: answer };
  await act(async () => renderer!.update(<AskEntry />));
  expect(shown()).toBe(true);
  expect(commit).toHaveBeenCalledOnce();
  expect(mock.baby.state.askNoticeSeen).toBe(true);
  // New chat, then another answer: not again.
  mock.ask = { messages: [] };
  await act(async () => renderer!.update(<AskEntry />));
  expect(shown()).toBe(false);
  mock.ask = { messages: answer };
  await act(async () => renderer!.update(<AskEntry />));
  expect(shown()).toBe(false);
  expect(commit).toHaveBeenCalledOnce();
});
it("says when an older conversation from History searches only part of the app", async () => {
  mock.ask = { context: { scope: "care", record_id: null, child_id: null }, messages: [{ role: "user", content: "Q" }] };
  await mount(<AskEntry />);
  expect(renderer!.root.findAllByType("Text" as React.ElementType).some(t => t.props.children === "Care logs only")).toBe(true);
});

it("shows a retained scope beside the child, so a follow-up never quietly leaves out Journal and Saved", async () => {
  mock.baby.state.bootstrap.children = [{ id: "isla", name: "Isla" }];
  mock.ask = { context: { scope: "care", record_id: null, child_id: "isla" }, messages: [{ role: "user", content: "Q" }] };
  await mount(<AskEntry />);
  const text = () => renderer!.root.findAllByType("Text" as React.ElementType).map((t) => t.props.children).join("|");
  expect(text()).toContain("For Isla · Care logs only");
  mock.ask = { context: { scope: "all", record_id: "entry", child_id: "isla" } };
  await act(async () => renderer!.update(<AskEntry />));
  expect(text()).toContain("For Isla");
  expect(text()).not.toContain("For Isla ·");
});
it("opens history separately from a long conversation and returns without losing its draft", async () => {
  const openHistory = vi.fn();
  mock.ask = { question: "Keep this draft", messages: [{ role: "user", content: "Earlier question" }], showHistory: true, openHistory,
    history: [{ id: "conversation", title: "Packing notes", updated_at: "2026-10-30T01:30:00Z" }] };
  await mount(<AskEntry />);
  expect(renderer!.root.findByType(Screen).props.followEnd).toBe(false);
  const text = () => renderer!.root.findAllByType("Text" as React.ElementType);
  expect(text().some(t => t.props.children === "Earlier question")).toBe(false);
  expect(text().find(t => t.props.children === new Date("2026-10-30T01:30:00Z").toLocaleDateString())?.props.style.fontVariant).toEqual(["tabular-nums"]);
  expect(renderer!.root.findByType("TextInput" as React.ElementType).props.value).toBe("Keep this draft");
  await press("Done"); expect(openHistory).toHaveBeenCalledOnce();
  mock.ask.showHistory = false;
  await act(async () => renderer!.update(<AskEntry />));
  expect(text().some(t => t.props.children === "Earlier question")).toBe(true);
  expect(renderer!.root.findByType("TextInput" as React.ElementType).props.value).toBe("Keep this draft");
});
it("groups conversation history and saved references while keeping their navigation", async () => {
  const load = vi.fn();
  mock.ask = { showHistory: true, load, history: [
    { id: "one", title: "First conversation" }, { id: "two", title: "Second conversation" },
  ] };
  await mount(<AskEntry />);
  expect(renderer!.root.findAllByType(Grouped)).toHaveLength(1);
  await press("Second conversation");
  expect(load).toHaveBeenCalledWith("two");
  mock.ask = { showHistory: false, messages: [{ role: "assistant", content: "Here are your sources.", citations: [
    { id: "first", title: "A saved tip", excerpt: "Details", kind: "source" },
    { id: "second", title: "Another saved tip", excerpt: "More details", kind: "source" },
  ] }] };
  await act(async () => renderer!.update(<AskEntry />));
  expect(renderer!.root.findAllByType(Grouped)).toHaveLength(1);
  await press("2. Another saved tip");
  expect(mock.stack.at(-1)).toEqual({ pathname: "/record/[id]", params: { id: "second" } });
});
it("reserves the measured Ask composer, lifts toasts above it, adjusts for keyboard, and removes both subscriptions", async () => {
  await mount(<AskEntry />);
  const footer = () => renderer!.root.findAllByType("View" as React.ElementType).find(v => v.props.onLayout)!;
  expect(Object.keys(mock.keyboard)).toEqual(["keyboardWillShow", "keyboardWillHide"]);
  await act(async () => footer().props.onLayout({ nativeEvent: { layout: { height: 150 } } }));
  const reserved = () => renderer!.root.findAllByType("ScrollView" as React.ElementType).find(s => !s.props.horizontal)!.props.contentContainerStyle.paddingBottom;
  // The automatic content inset already covers the 34pt safe area the footer pads, so only the rest is reserved.
  expect(reserved()).toBe(150 - 34);
  expect(footer().props.style.paddingBottom).toBe(34);
  expect(getDockedFooterHeight()).toBe(150);
  await act(async () => mock.keyboard.keyboardWillShow());
  expect(footer().props.style.paddingBottom).toBe(10);
  expect(reserved()).toBe(150);
  // Above the keyboard the composer is out of the toast's way.
  expect(getDockedFooterHeight()).toBe(0);
  await act(async () => mock.keyboard.keyboardWillHide());
  expect(footer().props.style.paddingBottom).toBe(34);
  await act(async () => renderer!.unmount()); renderer = undefined;
  expect(getDockedFooterHeight()).toBe(0);
  expect(mock.removed).toEqual(["keyboardWillShow", "keyboardWillHide"]);
});

it("keeps a full saved-source title readable in the entry content", async () => {
  const record = mock.baby.records.find((r: any) => r.kind === "source");
  record.title = "A simple hospital bag checklist";
  mock.params = { id: record.id };
  await mount(<RecordDetail />);
  expect(renderer!.root.findByType(Screen).props.title).toBe("Saved source");
  expect(renderer!.root.findAllByType("Text" as React.ElementType).some(t => t.props.children === record.title)).toBe(true);
});

it.each([false, true])("refreshes the scoped timeline from page zero after sync, preserving loaded entries (care=%s)", async careHistory => {
  mock.params = { filter: "question" };
  mock.baby.state.selectedChild = "baby";
  const kind = careHistory ? "feeding" : "question";
  const old = { ...row("Old matching entry", kind), child_id: "baby" };
  const older = { ...old, id: "older", title: "Older matching entry" };
  const fresh = { ...old, id: "fresh", title: "New matching entry" };
  let synced = false;
  mock.baby.records = [old, older];
  mock.baby.state.records = [old, older];
  mock.baby.commit = async (change: any) => { mock.baby.state = change(mock.baby.state); };
  const records = vi.fn(async ({ offset }: any) => ({
    items: offset ? [older] : synced ? [fresh] : [old], total: synced ? 3 : 2, has_more: !offset,
  }));
  mock.baby.api.records = records;
  mock.baby.sync = vi.fn(async () => {
    synced = true;
    mock.baby.state = { ...mock.baby.state, records: [fresh, ...mock.baby.state.records] };
  });
  await mount(<JournalContent careHistory={careHistory} />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  if (careHistory) await press("Search");
  const search = renderer!.root.findByType("TextInput" as React.ElementType);
  await act(async () => search.props.onChangeText("matching"));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  await press("Load more matches");
  const visible = () => renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.id);
  expect(visible()).toEqual(expect.arrayContaining([old.id, older.id]));
  await act(async () => { await renderer!.root.findByType(Screen).props.onRefresh(); });
  expect(mock.baby.sync).toHaveBeenCalledOnce();
  expect(records.mock.calls.at(-1)![0]).toMatchObject({ offset: 0, child_id: "baby", q: "matching", kinds: careHistory ? expect.arrayContaining(["feeding", "sleep", "diaper", "pumping", "medicine", "temperature", "growth", "custom", "kick_session", "contraction"]) : ["question"] });
  expect(visible()).toEqual(expect.arrayContaining([fresh.id, old.id, older.id]));
  expect(renderer!.root.findByType("TextInput" as React.ElementType).props.value).toBe("matching");
});

const tip = (id: string, data: Record<string, unknown>) => ({ ...optimisticRecord({ id, kind: "source", title: id, body: "", child_id: null,
  occurred_at: "2026-10-30T00:00:00Z", data: { status: "ready", ...data } }), revision: 3 });
const labor = { name: "Labor prep", collection_id: "labor", confidence: 0.9, status: "pending" };
it("accepts one suggested category, all of them, or says not this from Uncategorized", async () => {
  const records = [tip("Pregnancy tea at 37 weeks", { suggested_category: labor }), tip("Hospital bag list", { suggested_category: { ...labor, name: "Hospital bag", collection_id: null } }),
    tip("Untitled reel", {})];
  const decide = vi.fn(async (items: { record_id: string }[], _g: number, action = "accept") => ({
    results: items.map(({ record_id }) => ({ record_id, status: action === "accept" ? "accepted" : "dismissed", collection_id: "labor" })), records: [], collections: [] }));
  mock.baby = { ...mock.baby, records, state: { ...mock.baby.state, records }, api: { ...mock.baby.api, decideSuggestions: decide, record: async () => records[0] } };
  await mount(<Library />);
  const text = () => renderer!.root.findAllByType("Text" as React.ElementType).map(n => [n.props.children].flat().join(""));
  // Saved opens on All saved; suggestions wait under Uncategorized.
  expect(text()).not.toContain("Suggested: Labor prep");
  await press("Uncategorized");
  expect(text()).toContain("Suggested: Labor prep");
  expect(text()).toContain("Suggested: Hospital bag (new)");
  await press("Add “Pregnancy tea at 37 weeks” to Labor prep");
  expect(decide).toHaveBeenLastCalledWith([{ record_id: "Pregnancy tea at 37 weeks", revision: 3 }], 1);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await press("Accept all 2 suggestions");
  expect(decide).toHaveBeenLastCalledWith([{ record_id: "Pregnancy tea at 37 weeks", revision: 3 }, { record_id: "Hospital bag list", revision: 3 }], 1);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await press("Not Hospital bag for “Hospital bag list”");
  expect(decide).toHaveBeenLastCalledWith([{ record_id: "Hospital bag list", revision: 3 }], 1, "dismiss");
  await press("All saved");
  expect(text()).not.toContain("Suggested: Labor prep");
});
const sourceView = () => mock.views.filter(view => view.kind === "source").at(-1);
it("filters Saved to what's useful now or coming up once a due date exists, including from Today's See all", async () => {
  const due = new Date(Date.now() + 39 * 86400000), iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  const records = [tip("Pregnancy tea", { relevance: { stage: "pregnancy", pregnancy_week_min: 37 } }), tip("Bag", { relevance: { pregnancy_week_min: 35 } })];
  mock.baby = { ...mock.baby, records, state: { ...mock.baby.state, records, bootstrap: { ...mock.baby.state.bootstrap, children: [{ id: "kid", name: "Baby girl", due_date: iso, revision: 1 }] } } };
  await mount(<Library />);
  await press("For now");
  expect(sourceView()).toMatchObject({ uncategorized: false, timing: { mode: "now", childId: "kid", context: { stage: "pregnancy", value: 34 } } });
  await press("Coming up");
  expect(sourceView().timing.mode).toBe("upcoming");
  expect(renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.id)).toEqual(["Bag", "Pregnancy tea"]);
  await act(async () => renderer!.unmount()); renderer = undefined;
  mock.params = { view: "now", at: "1" };
  await mount(<Library />);
  expect(sourceView().timing.mode).toBe("now");
  mock.baby.state.bootstrap.children = [];
  await act(async () => renderer!.update(<Library />));
  expect(renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).some(n => n.props.accessibilityLabel === "For now")).toBe(false);
});
it("shows a saved tip's stated timing with its quote and saves a simple edit through the outbox", async () => {
  const record = tip("Pregnancy tea", { relevance: { stage: "pregnancy", pregnancy_week_min: 37, quote: "When you get to 37 weeks", origin: "source" } });
  const queue = vi.fn(async () => {});
  mock.baby = { ...mock.baby, records: [record], state: { ...mock.baby.state, records: [record] }, queue };
  mock.params = { id: "Pregnancy tea" };
  await mount(<RecordDetail />);
  await press("From 37 weeks. “When you get to 37 weeks”");
  const from = renderer!.root.findAllByType("TextInput" as React.ElementType).find(n => n.props.accessibilityLabel === "From week")!;
  await act(async () => from.props.onChangeText("36"));
  await press("Save timing");
  expect(queue).toHaveBeenCalledWith(expect.objectContaining({ type: "save", record: expect.objectContaining({ data: expect.objectContaining({
    relevance: expect.objectContaining({ stage: "pregnancy", pregnancy_week_min: 36, quote: null }) }) }) }));
  await press("From 37 weeks. “When you get to 37 weeks”");
  await press("Any time");
  await press("Save timing");
  expect(queue).toHaveBeenLastCalledWith(expect.objectContaining({ record: expect.objectContaining({ data: expect.objectContaining({ relevance: null }) }) }));
});
const checked = () => renderer!.root.findAllByType("AnimatedPressable" as React.ElementType)
  .filter(n => n.props.accessibilityRole === "radio" && n.props.accessibilityState?.checked).map(n => n.props.accessibilityLabel);
it("shows a cleared timing marker exactly like no timing, and 'Set by you' only beside a stated range", async () => {
  const cleared = tip("Pregnancy tea", { relevance: { origin: "user", stage: null, pregnancy_week_min: null, pregnancy_week_max: null, quote: null } });
  mock.baby = { ...mock.baby, records: [cleared], state: { ...mock.baby.state, records: [cleared] } };
  mock.params = { id: "Pregnancy tea" };
  await mount(<RecordDetail />);
  const labels = () => renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).map(n => String(n.props.accessibilityLabel));
  expect(labels()).toContain("Add when this is useful. A pregnancy week or baby age");
  expect(labels().some(label => label.includes("Set by you"))).toBe(false);
  const set = { ...cleared, data: { ...cleared.data, relevance: { origin: "user" as const, pregnancy_week_min: 36 } } };
  mock.baby = { ...mock.baby, records: [set], state: { ...mock.baby.state, records: [set] } };
  await act(async () => renderer!.update(<RecordDetail />));
  expect(labels()).toContain("From 36 weeks. Set by you");
});
it("orders Saved's chips All saved, For now, Coming up, Uncategorized, then her topics, and opens a topic in one tap", async () => {
  const due = new Date(Date.now() + 39 * 86400000), iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  const folder = (id: string, title: string) => ({ ...optimisticRecord({ id, kind: "collection", title, body: "", child_id: null,
    occurred_at: "2026-10-30T00:00:00Z", data: { record_ids: [] } }), revision: 1 });
  const records = [tip("Bag", {}), folder("bag", "Hospital bag"), folder("sleep", "Sleep")];
  mock.baby = { ...mock.baby, records, state: { ...mock.baby.state, records, bootstrap: { ...mock.baby.state.bootstrap,
    children: [{ id: "kid", name: "Isla", due_date: iso, revision: 1 }] } } };
  await mount(<Library />);
  const radios = () => renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).filter(n => n.props.accessibilityRole === "radio");
  expect(radios().map(n => n.props.accessibilityLabel)).toEqual(["All saved", "For now", "Coming up", "Uncategorized", "Hospital bag", "Sleep", "Categories"]);
  expect(checked()).toEqual(["All saved"]);
  await press("Sleep");
  expect(checked()).toEqual(["Sleep"]);
  expect(sourceView()).toMatchObject({ collectionId: "sleep", uncategorized: false });
  await press("Categories");
  expect(checked()).toEqual(["Categories"]);
  await press("Hospital bag. 0 saved posts");
  expect(checked()).toEqual(["Hospital bag"]);
});
it("falls back to All saved when For now has no current week, such as a due date past 44 weeks", async () => {
  const records = [tip("Pregnancy tea", { relevance: { stage: "pregnancy" } })];
  mock.baby = { ...mock.baby, records, state: { ...mock.baby.state, records, bootstrap: { ...mock.baby.state.bootstrap,
    children: [{ id: "kid", name: "Isla", due_date: "2025-12-01", revision: 1 }] } } };
  mock.params = { view: "now", at: "1" };
  await mount(<Library />);
  expect(checked()).toEqual(["All saved"]);
  expect(sourceView()).toMatchObject({ uncategorized: false, timing: undefined });
  expect(renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).some(n => n.props.accessibilityLabel === "For now")).toBe(false);
});
it("uses the ongoing pregnancy for Saved timing beside an older sibling", async () => {
  const records = [tip("Pregnancy tea", { relevance: { stage: "pregnancy" } })];
  mock.baby = { ...mock.baby, records, state: { ...mock.baby.state, records, bootstrap: { ...mock.baby.state.bootstrap,
    children: [{ id: "ana", name: "Ana", birth_date: "2024-04-01", revision: 1 }, { id: "isla", name: "Isla", due_date: "2099-12-10", revision: 1 }] } } };
  mock.params = { view: "now", at: "1" };
  await mount(<Library />);
  expect(sourceView()).toMatchObject({ timing: { mode: "now", childId: "isla", context: { stage: "pregnancy", value: 0 } } });
});
it("switches Journal's filter each time Today opens it, even to the same filter", async () => {
  mock.params = { filter: "question", at: "1" };
  await mount(<Journal />);
  expect(checked()).toEqual(["Doctor questions"]);
  await press("Journal");
  expect(checked()).toEqual(["Journal"]);
  mock.params = { filter: "question", at: "2" };
  await act(async () => renderer!.update(<Journal />));
  expect(checked()).toEqual(["Doctor questions"]);
});
it("hides suggestions on posts with a queued save, drops (new) for a same-name category, and ignores a double tap", async () => {
  const records = [tip("Pregnancy tea", { suggested_category: labor }), tip("Bag list", { suggested_category: { ...labor, name: "hospital bag", collection_id: null } }),
    tip("Colostrum", { suggested_category: { ...labor, name: "Breastfeeding", collection_id: null } }),
    { ...optimisticRecord({ id: "bag-folder", kind: "collection", title: "Hospital Bag", body: "", child_id: null, occurred_at: "2026-10-30T00:00:00Z", data: { record_ids: [] } }), revision: 2 }];
  let finish!: () => void;
  const decide = vi.fn((items: { record_id: string }[]) => new Promise((done) => { finish = () => done({
    results: items.map(({ record_id }) => ({ record_id, status: "accepted", collection_id: "labor" })), records: [], collections: [] }); }));
  const outbox = [{ type: "save", id: "m1", generation: 1, files: [], record: records[0] }];
  mock.baby = { ...mock.baby, records, state: { ...mock.baby.state, records, outbox }, api: { ...mock.baby.api, decideSuggestions: decide, record: async () => records[1] } };
  await mount(<Library />);
  await press("Uncategorized");
  const labels = () => renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).map(n => String(n.props.accessibilityLabel));
  expect(labels().some(label => label.includes("“Pregnancy tea”"))).toBe(false);
  expect(labels()).toContain("Add “Bag list” to hospital bag");
  expect(labels()).toContain("Add “Colostrum” to Breastfeeding (new category)");
  const button = renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).find(n => n.props.accessibilityLabel === "Accept all 2 suggestions")!;
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  expect(decide).toHaveBeenCalledTimes(1);
  expect(decide.mock.calls[0][0].map((item: { record_id: string }) => item.record_id)).toEqual(["Bag list", "Colostrum"]);
  await act(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(mock.toasts.at(-1)[0]).toBe("Filed 2 posts into 2 categories.");
});
it("offers another category when the suggested one can't be updated, and says plainly when offline", async () => {
  const records = [tip("Pregnancy tea", { suggested_category: labor })];
  const { ApiError } = await import("./api");
  const decide = vi.fn(async () => { throw new ApiError("Some details need review.", 422); });
  mock.baby = { ...mock.baby, records, state: { ...mock.baby.state, records }, api: { ...mock.baby.api, decideSuggestions: decide } };
  await mount(<Library />);
  await press("Uncategorized");
  await press("Add “Pregnancy tea” to Labor prep");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const notices = () => renderer!.root.findAllByType("Text" as React.ElementType).map(n => [n.props.children].flat().join(""));
  expect(notices()).toContain("This category can’t be updated. Choose another category.");
  await press("Choose another category");
  expect(mock.picker.sourceIds).toEqual(["Pregnancy tea"]);
  decide.mockImplementation(async () => { throw new ApiError("Could not connect.", 0); });
  await act(async () => mock.picker.onClose());
  await press("Add “Pregnancy tea” to Labor prep");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(notices()).toContain("You’re offline. Try again when you’re connected.");
  expect(labels422()).not.toContain("Choose another category");
  function labels422() { return renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).map(n => String(n.props.accessibilityLabel)); }
});


it("keeps Ask history named and the composer scalable at accessibility sizes", async () => {
  mock.fontScale = 3.1;
  await mount(<AskEntry />);
  const input = renderer!.root.findByType("TextInput" as React.ElementType);
  expect(input.props.maxFontSizeMultiplier).toBe(0);
  expect(input.props.style.fontSize).toBe(17);
  expect(renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).some(n => n.props.accessibilityLabel === "History")).toBe(true);
  mock.fontScale = 1;
  await act(async () => renderer!.update(<AskEntry />));
  expect(renderer!.root.findByType("TextInput" as React.ElementType)).not.toBe(input);
});

it("shows a custom entry's own title beside its numbers, and doesn't repeat a medicine's name", async () => {
  const bath = optimisticRecord({ id: "bath", kind: "custom", title: "First bath with Dad", body: "", child_id: null, occurred_at: "2026-11-04T02:00:00Z", data: { label: "Bath", value: 2, unit: "min" } as never });
  mock.baby.records = [bath]; mock.baby.state = { ...mock.baby.state, records: [bath] }; mock.params = { id: bath.id };
  await mount(<RecordDetail />);
  expect(JSON.stringify(renderer!.toJSON())).toContain("First bath with Dad");
  await act(async () => renderer!.unmount());
  const dose = optimisticRecord({ id: "dose", kind: "medicine", title: "Vitamin D", body: "", child_id: null, occurred_at: "2026-11-04T02:00:00Z", data: { name: "Vitamin D" } as never });
  mock.baby.records = [dose]; mock.baby.state = { ...mock.baby.state, records: [dose] }; mock.params = { id: dose.id };
  await mount(<RecordDetail />);
  expect((JSON.stringify(renderer!.toJSON()).match(/Vitamin D/g) ?? []).length).toBe(1);
});

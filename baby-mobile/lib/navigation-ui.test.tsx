import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  fontScale: 1, ask: {} as any, keyboard: {} as Record<string, () => void>, removed: [] as string[],
  params: {} as Record<string, string>, stack: [] as any[], baby: null as any,
  exportVisit: vi.fn(async (_text: string, _owner: string) => {}),
}));
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
  Stack: { Screen: ({ options }: any) => options?.headerRight?.() ?? null },
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
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/files", () => ({ exportVisit: mock.exportVisit }));
vi.mock("@/components/child-filter", () => ({ ChildFilter: () => null }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: () => null }));
vi.mock("@/components/record-row", () => ({ RecordRow: "RecordRow", kindIcon: {} }));
vi.mock("@/components/private-attachment", () => ({ PrivateAttachment: "PrivateAttachment" }));
vi.mock("@/components/source-content", () => ({ SourceContent: "SourceContent" }));
vi.mock("@/lib/use-ask-session", () => ({ useAskSession: (record_id: string) => ({
  context: { scope: "all", record_id, child_id: null }, focusedTitle: "Saved source", question: "", messages: [],
  history: [], showHistory: false, resolving: false, busy: false, error: "", openHistory() {}, ...mock.ask,
}) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/history", () => import("./history"));
vi.mock("@/lib/visit-summary", () => import("./visit-summary"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/chat-citations", () => import("./chat-citations"));
vi.mock("@/components/header-search", () => import("../components/header-search"));
vi.mock("@/components/tab-stack", () => import("../components/tab-stack"));
vi.mock("@/components/ui", () => import("../components/ui"));
vi.mock("@/components/disclosure", () => import("../components/disclosure"));
vi.mock("./ai-consent", () => ({ ensureAiConsent: async () => true }));
vi.mock("@/components/ask-screen", () => import("../components/ask-screen"));
vi.mock("@/lib/source-title", () => import("./source-title"));
vi.mock("@/lib/use-library-history", () => ({ useLibraryHistory: ({ kind }: { kind: string }) => ({
  rows: mock.baby.records.filter((record: any) => record.kind === kind), loading: false, error: "", more: false,
  refresh: () => {}, loadMore: async () => {},
}) }));
vi.mock("@/lib/categories", () => import("./categories"));
vi.mock("@/components/category-picker", () => ({ CategoryPicker: () => null }));
vi.mock("@/components/import-updates", () => ({ ImportUpdates: () => null }));
import Library from "../app/(tabs)/library";
import Journal, { JournalContent } from "../app/(tabs)/journal";
import RecordDetail from "../app/record/[id]";
import { Screen } from "../components/ui";
import AskEntry from "../app/ask-entry";
import { emptyState, optimisticRecord } from "./models";
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
  mock.params = {}; mock.stack = []; mock.exportVisit.mockClear();
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
it("prepares a mixed journal and care visit summary from Doctor questions", async () => {
  mock.params = { filter: "question" };
  await mount(<Journal />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  await press("Prepare a visit summary");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  await press("Journal observation");
  await press("Bottle observation");
  await press("Share 2 selected entries");
  const [text, owner] = mock.exportVisit.mock.calls[0];
  expect(owner).toBe("owner");
  expect(text).toContain("Observation Journal observation");
  expect(text).toContain("Observation Bottle observation");
  expect(text).not.toContain("Observation Doctor question");
  await press("Done choosing");
  expect(renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.kind)).toEqual(["question"]);
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

it("keeps compact Journal filters horizontal, writing-only, and clears route-driven visit selections", async () => {
  mock.params = { filter: "question" };
  await mount(<Journal />);
  await press("Prepare a visit summary");
  await press("Journal observation");
  mock.params = { filter: "all" };
  await act(async () => renderer!.update(<Journal />));
  expect(renderer!.root.findAllByType("RecordRow" as React.ElementType).map(n => n.props.record.kind)).toEqual(["journal", "question"]);
  expect(renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).some(n => n.props.accessibilityLabel === "Write")).toBe(false);
  expect(renderer!.root.findAllByType("ScrollView" as React.ElementType).some(n => n.props.horizontal)).toBe(true);
  mock.params = { filter: "question" };
  await act(async () => renderer!.update(<Journal />));
  await press("Prepare a visit summary");
  expect(renderer!.root.findAllByType("AnimatedPressable" as React.ElementType).some(n => n.props.accessibilityLabel === "Share 0 selected entries" && n.props.disabled)).toBe(true);
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
it("reserves the measured Ask composer, adjusts for keyboard, and removes both subscriptions", async () => {
  await mount(<AskEntry />);
  const footer = () => renderer!.root.findAllByType("View" as React.ElementType).find(v => v.props.onLayout)!;
  expect(Object.keys(mock.keyboard)).toEqual(["keyboardWillShow", "keyboardWillHide"]);
  await act(async () => footer().props.onLayout({ nativeEvent: { layout: { height: 150 } } }));
  expect(renderer!.root.findAllByType("ScrollView" as React.ElementType).find(s => !s.props.horizontal)!.props.contentContainerStyle.paddingBottom).toBe(150);
  expect(footer().props.style.paddingBottom).toBe(34);
  await act(async () => mock.keyboard.keyboardWillShow());
  expect(footer().props.style.paddingBottom).toBe(10);
  await act(async () => mock.keyboard.keyboardWillHide());
  expect(footer().props.style.paddingBottom).toBe(34);
  await act(async () => renderer!.unmount()); renderer = undefined;
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
  expect(records.mock.calls.at(-1)![0]).toMatchObject({ offset: 0, child_id: "baby", q: "matching", kinds: careHistory ? ["feeding", "sleep", "diaper"] : ["question"] });
  expect(visible()).toEqual(expect.arrayContaining([fresh.id, old.id, older.id]));
  expect(renderer!.root.findByType("TextInput" as React.ElementType).props.value).toBe("matching");
});

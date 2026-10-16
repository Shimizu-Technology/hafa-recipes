import { createElement, useEffect, useLayoutEffect, startTransition, Suspense, type Context } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey } from "./drafts";
import { streamCoachRequest } from "./coach-stream";
import type { CoachMessage } from "./coach";
const f = vi.hoisted(() => ({ owner: "", generation: 1, current: true, profileGate: null as Promise<{ adult_confirmed: boolean }> | null, run: 0, uuid: 0,
  params: {} as Record<string, string>, values: new Map<string, string>(), history: [] as CoachMessage[], historyCalls: [] as number[],
  paramsContext: null as Context<Record<string, string> | null> | null,
  stream: vi.fn(), streaming: false, stop: vi.fn(), writeFailure: false, coach: true, cancellation: true as boolean | undefined, consent: true,
  focusVersion: 0, routeFocused: true, pendingSaveGate: null as Promise<void> | null, storageVersion: 0, readiness: vi.fn(), send: vi.fn(), copy: vi.fn(), clear: vi.fn(), readFailure: false, push: vi.fn(),
  measureAnchor: vi.fn(), contentEnabled: false, contentView: {}, platform: "ios" as "web" | "ios", appState: "active", openURL: vi.fn(), scrollTo: vi.fn(), scrollEnd: vi.fn(), pageSize: 50,
  historyGate: null as Promise<{ messages: CoachMessage[]; limit: number; offset: number }> | null,
  bubble: null as typeof import("../components/design/surfaces").Bubble | null,
  foreground: new Set<(value: string) => void>() }));
vi.mock("@/lib/context", () => {
  const storage = { isCurrent: () => f.current,
    getItem: async (key: string) => { if (f.readFailure && key.includes("coach-draft")) throw Error("Disk unavailable"); return f.values.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (f.writeFailure) throw Error("Disk unavailable"); f.values.set(key, value); if (key.includes("coach-draft") && JSON.parse(value).pending && f.pendingSaveGate) await f.pendingSaveGate; },
    removeItem: async (key: string) => { f.values.delete(key); }, getAllKeys: async () => [...f.values.keys()] };
  const replacementStorage = { ...storage };
  const api = { profile: async () => f.profileGate ?? ({ adult_confirmed: true }), capabilities: async () => ({ coach: f.coach, coach_cancellation: f.cancellation, coach_streaming: f.streaming }),
    aiConsent: async () => ({ accepted: f.consent }), readiness: async () => ({}), setReadiness: f.readiness,
    coachHistory: async (offset = 0) => { f.historyCalls.push(offset); return offset && f.historyGate ? f.historyGate : ({ messages: f.history.slice(offset, offset + f.pageSize), limit: f.pageSize, offset }); }, coachMessage: f.send, coachStream: f.stream, cancelCoachMessage: f.stop, clearCoach: f.clear };
  return { useTraining: () => ({ api, owner: f.owner, enrollment: { enrolled: true, generation: f.generation }, storage: f.storageVersion ? replacementStorage : storage, isCurrentAccount: () => f.current }) };
});
vi.mock("react-native", () => ({ View: "View", Text: "Text", KeyboardAvoidingView: "KeyboardAvoidingView", ScrollView: "ScrollView", RefreshControl: "RefreshControl", Platform: { get OS() { return f.platform; } }, Linking: { openURL: f.openURL }, AppState: { get currentState() { return f.appState; }, addEventListener: (_: string, listener: (value: string) => void) => { f.foreground.add(listener); return { remove: () => f.foreground.delete(listener) }; } } }));
// Exercise the real Screen wrapper below without loading unrelated native modules.
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("../components/brand-mark", () => ({ BrandLockup: "BrandLockup", BrandMark: "BrandMark" }));
vi.mock("../components/design/foundation", () => ({ Copy: "Copy", SurfaceProvider: "SurfaceProvider", useColors: () => ({ background: "background" }), useReducedMotion: () => true, useSurface: () => "surface" }));
vi.mock("../components/design/controls", () => ({ Chip: "Chip", IconButton: "IconButton" }));
vi.mock("expo-clipboard", () => ({ setStringAsync: f.copy }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `request-${++f.uuid}` }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  f.paramsContext = React.createContext<Record<string, string> | null>(null);
  return { router: { push: f.push, replace: vi.fn() },
    useLocalSearchParams: () => React.useContext(f.paramsContext!) ?? f.params,
    useFocusEffect: (fn: () => void) => useEffect(() => f.routeFocused ? fn() : undefined, [fn, f.focusVersion, f.routeFocused]) };
});
vi.mock("@/components/ui", () => ({
  ...Object.fromEntries(["Button", "Card", "Chip", "ChipRow", "Copy", "Field", "ListGroup", "ListRow", "Notice", "SectionHeader"].map(name => [name, name])),
  Bubble: (props: React.ComponentProps<typeof import("../components/design/surfaces").Bubble>) => createElement(f.bubble ?? "Bubble", props),
  Sheet: (props: { visible: boolean; children?: React.ReactNode }) => props.visible ? createElement("Sheet", props, props.children) : null,
  useColors: () => ({ text: "ink", accentText: "accent", sunken: "sunken" }),
  Screen: (props: { children?: React.ReactNode; footer?: React.ReactNode; scrollRef?: { current: unknown } }) => {
    // Installed RNWeb binds forwardedRef when its scroll DOM node mounts.
    useLayoutEffect(() => {
      const node = { scrollTo: f.scrollTo, scrollToEnd: f.scrollEnd, getInnerViewRef: () => f.contentEnabled ? f.contentView : null };
      if (props.scrollRef) props.scrollRef.current = node;
      return () => { if (props.scrollRef?.current === node) props.scrollRef.current = null; };
    }, []);
    return createElement("Screen", props, props.children, createElement("PinnedFooter", null, props.footer));
  },
}));
vi.mock("@believer/react-native-markdown-display", async () => ({
  Markdown: "Markdown", MarkdownIt: (await vi.importActual<Record<string, unknown>>("markdown-it")).default,
}));
import Coach from "../app/coach";
let view: ReactTestRenderer | undefined, cache: QueryClient;
const nodes = (type: string) => view!.root.findAll(node => node.type === type);
const button = (title: string) => nodes("Button").find(node => node.props.title === title)!;
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); };
const mount = async () => { await act(async () => { view = create(createElement(QueryClientProvider, { client: cache }, createElement(Coach)), { createNodeMock: element => element.type === "View" ? { measureLayout: f.measureAnchor } : null }); }); await settle(); };
const refresh = async () => { await act(async () => { view!.update(createElement(QueryClientProvider, { client: cache }, createElement(Coach))); }); await settle(); };
const click = async (title: string) => { await act(async () => { button(title).props.onPress(); }); await settle(); };
const type = async (message: string) => { await act(async () => { nodes("Field")[0].props.onChange(message); }); await settle(); };
const unmount = async () => { if (view) { await act(async () => view!.unmount()); view = undefined; } };
const draft = () => JSON.parse(f.values.get(draftKey(f.owner, `coach-draft:${f.generation}:general`))!);
function reply(id: string, state: CoachMessage["state"] = "completed"): CoachMessage { return { id, request_id: id, generation: f.generation, state, user_message: `Question ${id}`, assistant_message: state === "completed" ? `Reply ${id}` : null, actions: [], created_at: `2026-10-15T00:0${id === "older" ? 0 : 1}:00Z`, focus: {} }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.profileGate = null; f.measureAnchor.mockReset(); f.contentEnabled = false; f.bubble = null;
  f.owner = `coach-owner-${++f.run}`; f.generation = 1; f.current = true; f.uuid = 0; f.params = {}; f.values.clear(); f.history = []; f.historyCalls = []; f.readFailure = false;
  f.focusVersion = 0; f.routeFocused = true; f.pendingSaveGate = null; f.storageVersion = 0; f.readiness.mockReset(); f.send.mockReset(); f.clear.mockReset(); f.copy.mockReset(); f.copy.mockResolvedValue(true);
  f.stream.mockReset(); f.streaming = false; f.stop.mockReset(); f.writeFailure = false; f.coach = true; f.cancellation = true; f.consent = true;
  f.platform = "ios"; f.appState = "active"; f.openURL.mockReset(); f.openURL.mockResolvedValue(undefined); f.scrollTo.mockReset(); f.scrollEnd.mockReset(); f.pageSize = 50; f.historyGate = null;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => { await unmount(); cache.clear(); });
it("reads chronologically with a pinned composer and copies the original reply with feedback", async () => {
  f.history = [reply("newer"), reply("older")]; await mount();
  expect(nodes("Markdown").map(node => node.props.children)).toEqual(["Reply older", "Reply newer"]);
  expect(nodes("Copy").filter(node => node.props.selectable)).toHaveLength(2);
  expect(nodes("PinnedFooter")[0].find(node => String(node.type) === "Field").props.compact).toBe(true);
  await act(async () => { nodes("Button").find(node => node.props.title === "Copy reply")!.props.onPress(); }); await settle();
  expect(f.copy).toHaveBeenCalledWith("Reply older"); expect(button("Reply copied")).toBeTruthy();
});
it("preserves unsent text through remount", async () => { await mount(); await type("Keep this draft"); await unmount(); await mount(); expect(nodes("Field")[0].props.value).toBe("Keep this draft"); });
it("retries the exact durable request after a lost acknowledgement and remount", async () => {
  f.send.mockRejectedValueOnce(Error("Connection interrupted")); await mount(); await type("Use the saved focus"); await click("Send message");
  const original = f.send.mock.calls[0]; expect(nodes("Field")).toHaveLength(0); await unmount(); await mount();
  f.send.mockResolvedValueOnce({ ...reply("request-1"), state: "completed" }); await click("Retry saved message");
  expect(f.send.mock.calls[1].slice(0, 4)).toEqual(original.slice(0, 4)); expect(f.uuid).toBe(1); expect(draft().pending).toBeNull();
});
it("keeps a failed message editable and requires an explicit new send", async () => {
  f.send.mockResolvedValueOnce(reply("request-1", "failed")); await mount(); await type("My useful question"); await click("Send message");
  expect(nodes("Field")[0].props.value).toBe("My useful question"); expect(nodes("Field")[0].props.disabled).toBe(false); expect(f.send).toHaveBeenCalledTimes(1);
  f.send.mockResolvedValueOnce(reply("request-2")); await click("Send message"); expect(f.send.mock.calls.map(args => args[0])).toEqual(["request-1", "request-2"]);
});
it("a failed history item restores a draft without sending or applying proposals", async () => {
  f.history = [reply("failed", "failed")]; await mount(); await click("Use message again"); expect(nodes("Field")[0].props.value).toBe("Question failed"); expect(f.send).not.toHaveBeenCalled();
});
it("a draft read failure cannot overwrite the saved request and offers a real restoration retry", async () => {
  const key = draftKey(f.owner, "coach-draft:1:general"), stored = JSON.stringify({ message: "Never discard", pending: null }); f.values.set(key, stored); f.readFailure = true;
  await mount(); expect(button("Send message").props.disabled).toBe(true); expect(f.values.get(key)).toBe(stored);
  f.readFailure = false; await click("Retry restoring message draft"); expect(nodes("Field")[0].props.value).toBe("Never discard");
});
it.each(["owner", "generation"])("ignores a late reply after the %s changes and preserves the new scope draft", async change => {
  const gate = deferred<CoachMessage>(); f.send.mockReturnValue(gate.promise); await mount(); await type("Old scope"); await click("Send message");
  if (change === "owner") f.owner = "other-owner"; else f.generation = 2; await refresh(); await type("New scope draft");
  await act(async () => gate.resolve(reply("old"))); await settle(); expect(nodes("Field")[0].props.value).toBe("New scope draft"); expect(draft().message).toBe("New scope draft"); expect(draft().pending).toBeNull();
});
it("shows recoverable copy errors without changing the conversation", async () => {
  f.history = [reply("older")]; f.copy.mockRejectedValueOnce(Error("Clipboard denied")); await mount(); await click("Copy reply");
  expect(nodes("Notice").some(node => String(node.props.children).includes("Could not copy"))).toBe(true); expect(f.send).not.toHaveBeenCalled();
});

it("a confirmed pending reply remains locked through refresh and checks the same request", async () => {
  f.send.mockImplementation(async (id, message) => { const item = { ...reply(id, "pending"), request_id: id, user_message: message }; f.history = [item]; return item; });
  await mount(); await type("Prepare a reply"); await click("Send message");
  expect(button("Check for reply")).toBeTruthy(); const original = f.send.mock.calls[0];
  await click("Check for reply"); expect(f.send.mock.calls[1].slice(0, 4)).toEqual(original.slice(0, 4)); expect(f.uuid).toBe(1); expect(nodes("Field")).toHaveLength(0);
});
it("a response arriving after the private storage lease closes cannot change the local draft", async () => {
  const gate = deferred<CoachMessage>(); f.send.mockReturnValue(gate.promise); await mount(); await type("Keep pending"); await click("Send message");
  const saved = draft(); f.current = false; await act(async () => gate.resolve(reply("late"))); await settle();
  expect(draft()).toEqual(saved); expect(nodes("Field")).toHaveLength(0); expect(nodes("Copy").some(node => node.props.accessibilityLabel === "Your message: Keep pending")).toBe(true);
});
it("an existing reviewed proposal remains an explicit navigation action", async () => {
  f.history = [{ ...reply("older"), actions: [{ proposal_id: "suggestion", kind: "schedule", status: "ready", state: "proposed" }] }];
  await mount(); expect(f.send).not.toHaveBeenCalled(); await click("Review schedule suggestion");
  expect(f.push).toHaveBeenCalledWith({ pathname: "/coach-action/[id]", params: { id: "suggestion", generation: "1", state: "proposed" } });
});

it("reusing an old failed message preserves the current draft until replacement is confirmed", async () => {
  f.history = [reply("failed", "failed")]; await mount(); await type("Current unsent question"); await click("Use message again");
  expect(nodes("Field")[0].props.value).toBe("Current unsent question"); await click("Keep my draft");
  expect(draft().message).toBe("Current unsent question"); await click("Use message again"); await click("Replace unsent draft");
  expect(draft().message).toBe("Question failed"); expect(f.send).not.toHaveBeenCalled();
});


function bindScroll() {
  const screen = nodes("Screen")[0];
  screen.props.scrollRef.current = { scrollTo: f.scrollTo, scrollToEnd: f.scrollEnd, getInnerViewRef: () => f.contentEnabled ? f.contentView : null };
  return screen;
}
const scrollEvent = (y: number, height = 2000) => ({ nativeEvent: { contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: 400 } } });
it("follows new replies only at the latest message and offers a deliberate jump while reading", async () => {
  f.history = [reply("newer"), reply("older")]; await mount();
  await act(async () => bindScroll().props.onContentSizeChange(390, 2000));
  expect(f.scrollEnd).toHaveBeenCalledWith({ animated: false }); f.scrollEnd.mockClear();
  await act(async () => bindScroll().props.onScroll(scrollEvent(200)));
  await act(async () => bindScroll().props.onContentSizeChange(390, 2200));
  expect(f.scrollEnd).not.toHaveBeenCalled(); expect(button("Jump to latest reply")).toBeTruthy();
  await click("Jump to latest reply"); expect(f.scrollEnd).toHaveBeenCalledWith({ animated: true });
});
it("keeps the visible message anchored when earlier pages are prepended", async () => {
  f.pageSize = 2; const earliest = { ...reply("earliest"), created_at: "2026-10-14T00:00:00Z" };
  f.history = [reply("newer"), reply("older"), earliest]; await mount(); bindScroll();
  const row = (question: string) => nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === question).length)!;
  await act(async () => row("Question older").props.onLayout({ nativeEvent: { layout: { y: 500 } } }));
  await act(async () => bindScroll().props.onScroll(scrollEvent(550)));
  await click("Load earlier messages");
  expect(nodes("Markdown").map(node => node.props.children)).toEqual(["Reply earliest", "Reply older", "Reply newer"]);
  await act(async () => bindScroll().props.onContentSizeChange(390, 2400)); expect(f.scrollEnd).not.toHaveBeenCalled();
  await act(async () => row("Question older").props.onLayout({ nativeEvent: { layout: { y: 900 } } }));
  expect(f.scrollTo).toHaveBeenCalledWith({ y: 950, animated: false });
  expect(nodes("PinnedFooter")[0].find(node => String(node.type) === "Field").props.value).toBe("");
});
it("measures a prepended anchor when its unchanged size emits no new layout event", async () => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older")];
  const gate = deferred<{ messages: CoachMessage[]; limit: number; offset: number }>(); f.historyGate = gate.promise;
  await mount();
  const row = nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === "Question older").length)!;
  f.measureAnchor.mockImplementation((_content, success) => success(0, f.historyCalls.includes(2) ? 900 : 520));
  await act(async () => {
    row.props.onLayout({ nativeEvent: { layout: { y: 500 } } });
    bindScroll().props.onScroll(scrollEvent(550));
  });
  await click("Load earlier messages");
  await act(async () => gate.resolve({ messages: [{ ...reply("earliest"), created_at: "2026-10-14T00:00:00Z" }], limit: 2, offset: 2 })); await settle();
  expect(f.measureAnchor).toHaveBeenCalledWith(f.contentView, expect.any(Function), expect.any(Function));
  expect(f.scrollTo).toHaveBeenCalledWith({ y: 930, animated: false });
});
it.each(["jump", "owner", "storage"])("ignores a delayed anchor measurement after %s retires it", async retirement => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older")];
  const page = deferred<{ messages: CoachMessage[]; limit: number; offset: number }>(); f.historyGate = page.promise;
  await mount();
  const row = nodes("View").find(node => node.props.onLayout)!;
  await act(async () => { row.props.onLayout({ nativeEvent: { layout: { y: 500 } } }); bindScroll().props.onScroll(scrollEvent(550)); });
  let measured!: (x: number, y: number) => void;
  f.measureAnchor.mockImplementation((_content, success) => { if (!f.historyCalls.includes(2)) success(0, 500); else measured = success; });
  await click("Load earlier messages");
  await act(async () => page.resolve({ messages: [{ ...reply("earliest"), created_at: "2026-10-14T00:00:00Z" }], limit: 2, offset: 2 })); await settle();
  expect(measured).toBeTypeOf("function");
  if (retirement === "jump") await click("Jump to latest reply");
  else { if (retirement === "owner") f.owner = "replacement"; else f.storageVersion++; await refresh(); }
  await act(async () => measured(0, 900));
  expect(f.scrollTo).not.toHaveBeenCalled();
});
it("preserves a scroll made during measurement and excludes a simultaneous reply below the anchor", async () => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older")];
  const page = deferred<{ messages: CoachMessage[]; limit: number; offset: number }>(); f.historyGate = page.promise;
  await mount();
  const row = nodes("View").find(node => node.props.onLayout)!;
  await act(async () => { row.props.onLayout({ nativeEvent: { layout: { y: 500 } } }); bindScroll().props.onScroll(scrollEvent(550)); });
  let measured!: (x: number, y: number) => void;
  f.measureAnchor.mockImplementation((_content, success) => { if (!f.historyCalls.includes(2)) success(0, 500); else measured = success; });
  await click("Load earlier messages");
  await act(async () => page.resolve({ messages: [{ ...reply("earliest"), created_at: "2026-10-14T00:00:00Z" }, { ...reply("latest"), created_at: "2026-10-16T00:00:00Z" }], limit: 2, offset: 2 })); await settle();
  await act(async () => {
    // A queued size notification can report its old position before the
    // explicit measurement. It must not consume the measured anchor.
    nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === "Question older").length)!.props.onLayout({ nativeEvent: { layout: { y: 500 } } });
    nodes("Screen")[0].props.onScroll(scrollEvent(650, 5000)); measured(0, 900);
  });
  expect(f.scrollTo).toHaveBeenCalledWith({ y: 1050, animated: false });
  expect(f.scrollEnd).not.toHaveBeenCalled();
});
it("refreshes unchanged row positions for another prepend while retaining fresh native layouts", async () => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older")];
  const page = deferred<{ messages: CoachMessage[]; limit: number; offset: number }>(); f.historyGate = page.promise;
  await mount();
  const row = (text: string) => nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === text).length)!;
  await act(async () => {
    row("Question older").props.onLayout({ nativeEvent: { layout: { y: 500 } } });
    row("Question newer").props.onLayout({ nativeEvent: { layout: { y: 1300 } } });
    bindScroll().props.onScroll(scrollEvent(550));
  });
  let measured!: (x: number, y: number) => void;
  f.measureAnchor.mockImplementation((_content, success) => { if (!f.historyCalls.includes(2)) success(0, 500); else measured = success; });
  await click("Load earlier messages");
  await act(async () => page.resolve({ messages: ["early-a", "early-b"].map((id, i) => ({ ...reply(id), created_at: `2026-10-1${3 + i}T00:00:00Z` })), limit: 2, offset: 2 })); await settle();
  await act(async () => { row("Question newer").props.onLayout({ nativeEvent: { layout: { y: 1800 } } }); measured(0, 900); });
  f.scrollTo.mockClear();
  f.measureAnchor.mockImplementationOnce((_content, success) => success(0, 1800));
  await act(async () => nodes("Screen")[0].props.onScroll(scrollEvent(1850, 5000)));
  const next = deferred<{ messages: CoachMessage[]; limit: number; offset: number }>(); f.historyGate = next.promise;
  await click("Load earlier messages");
  await act(async () => next.resolve({ messages: [{ ...reply("oldest"), created_at: "2026-10-12T00:00:00Z" }], limit: 2, offset: 4 })); await settle();
  await act(async () => measured(0, 1900));
  expect(f.scrollTo).toHaveBeenCalledWith({ y: 1950, animated: false });
});
it.each(["jump", "owner", "storage"])("does not fetch older history after %s retires the initial measurement", async retirement => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older")]; await mount();
  await act(async () => { nodes("View").find(node => node.props.onLayout)!.props.onLayout({ nativeEvent: { layout: { y: 500 } } }); bindScroll().props.onScroll(scrollEvent(550)); });
  let measured!: (x: number, y: number) => void;
  f.measureAnchor.mockImplementation((_content, success) => { measured = success; });
  await click("Load earlier messages"); expect(measured).toBeTypeOf("function");
  if (retirement === "jump") await click("Jump to latest reply");
  else { if (retirement === "owner") f.owner = "replacement"; else f.storageVersion++; await refresh(); }
  await act(async () => measured(0, 508)); await settle();
  expect(f.historyCalls).not.toContain(2); expect(f.scrollTo).not.toHaveBeenCalled();
});
it("releases a failed initial measurement so loading earlier can be retried", async () => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older"), { ...reply("earliest"), created_at: "2026-10-14T00:00:00Z" }]; await mount();
  await act(async () => { nodes("View").find(node => node.props.onLayout)!.props.onLayout({ nativeEvent: { layout: { y: 500 } } }); bindScroll().props.onScroll(scrollEvent(550)); });
  f.measureAnchor.mockImplementationOnce((_content, _success, failure) => failure());
  await click("Load earlier messages"); expect(f.historyCalls).not.toContain(2);
  expect(nodes("Notice").some(node => node.props.children === "Could not keep your reading position. Try loading earlier messages again.")).toBe(true);
  f.measureAnchor.mockImplementationOnce((_content, success) => success(0, 500)).mockImplementation((_content, success) => success(0, 900));
  await click("Load earlier messages"); expect(f.historyCalls).toContain(2);
  expect(nodes("Notice").some(node => node.props.children === "Could not keep your reading position. Try loading earlier messages again.")).toBe(false);
  expect(f.scrollTo).toHaveBeenCalledWith({ y: 950, animated: false });
});
it("ignores an initial measurement failure after Jump retires it", async () => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older")]; await mount();
  await act(async () => { nodes("View").find(node => node.props.onLayout)!.props.onLayout({ nativeEvent: { layout: { y: 500 } } }); bindScroll().props.onScroll(scrollEvent(550)); });
  let fail!: () => void;
  f.measureAnchor.mockImplementation((_content, _success, failure) => { fail = failure; });
  await click("Load earlier messages"); await click("Jump to latest reply"); await type("Fresh unsent question");
  await act(async () => fail()); await settle();
  expect(f.historyCalls).not.toContain(2);
  expect(nodes("Notice").some(node => String(node.props.children).includes("Could not keep your reading position"))).toBe(false);
  expect(nodes("Field")[0].props.value).toBe("Fresh unsent question");
});
it("measures visibility after sending rotates the first history page without row layout events", async () => {
  f.contentEnabled = true; f.pageSize = 2; f.history = [reply("newer"), reply("older")]; await mount();
  const row = (text: string) => nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === text).length)!;
  await act(async () => {
    row("Question older").props.onLayout({ nativeEvent: { layout: { y: 500 } } });
    row("Question newer").props.onLayout({ nativeEvent: { layout: { y: 1300 } } });
  });
  f.send.mockImplementation(async requestId => { const sent = { ...reply("latest"), request_id: requestId, created_at: "2026-10-16T00:00:00Z" }; f.history = [sent, reply("newer"), reply("older")]; return sent; });
  await type("A new question"); await click("Send message");
  expect(nodes("Markdown").map(node => node.props.children)).toEqual(["Reply newer", "Reply latest"]);
  // The retained row moved up to500, but its unchanged size emitted no layout.
  f.measureAnchor.mockImplementation((_content, success) => success(0, f.historyCalls.includes(2) ? 900 : 500));
  await act(async () => bindScroll().props.onScroll(scrollEvent(550)));
  await click("Load earlier messages");
  expect(f.measureAnchor).toHaveBeenCalledTimes(2);
  expect(f.scrollTo).toHaveBeenCalledWith({ y: 950, animated: false });
});
it("disables HTML and remote images while retaining selectable Markdown text", async () => {
  f.history = [{ ...reply("older"), assistant_message: "**Plan**\n- Row\n![track](https://evil.test/pixel)\n<script>bad()</script>" }]; await mount();
  const md = nodes("Markdown")[0].props;
  expect(md.markdownit.options.html).toBe(false); expect(md.rules.image()).toBeNull();
  expect(md.markdownit.render("<script>bad()</script>")).not.toContain("<script>");
  expect(md.markdownit.validateLink("javascript:alert(1)")).toBe(false);
  expect(md.rules.textgroup({ key: "text" }, ["Row"], [], {}).props.selectable).toBe(true);
  expect(md.children).toContain("**Plan**");
  await click("Copy reply"); expect(f.copy).toHaveBeenCalledWith(f.history[0].assistant_message);
});
it.each(["web", "ios"] as const)("confirms HTTP links using the app sheet on %s", async platform => {
  f.platform = platform; f.history = [reply("older")]; await mount();
  await act(async () => { expect(nodes("Markdown")[0].props.onLinkPress("https://example.test/workout")).toBe(false); });
  expect(nodes("Sheet")[0].props.title).toBe("Open this link?");
  expect(nodes("Copy").some(node => node.props.children === "example.test")).toBe(true);
  expect(f.openURL).not.toHaveBeenCalled();
  const confirm = button("Open link").props.onPress;
  await act(async () => { confirm(); confirm(); }); await settle();
  expect(f.openURL).toHaveBeenCalledTimes(1);
  expect(f.openURL).toHaveBeenCalledWith("https://example.test/workout");
  expect(nodes("Sheet")).toHaveLength(0);
});
it("cancel retires a captured link confirmation", async () => {
  f.history = [reply("older")]; await mount();
  await act(async () => { nodes("Markdown")[0].props.onLinkPress("https://example.test/cancel"); });
  const confirm = button("Open link").props.onPress;
  await click("Cancel"); await act(async () => confirm());
  expect(nodes("Sheet")).toHaveLength(0); expect(f.openURL).not.toHaveBeenCalled();
});
it.each(["javascript:alert(1)", "https://user:secret@example.test/", "file:///private"])("rejects unsafe coach link %s with visible feedback", async url => {
  f.history = [reply("older")]; await mount();
  await act(async () => { expect(nodes("Markdown")[0].props.onLinkPress(url)).toBe(false); });
  expect(nodes("Sheet")).toHaveLength(0); expect(f.openURL).not.toHaveBeenCalled();
  expect(nodes("Notice").some(node => String(node.props.children).includes("cannot be opened safely"))).toBe(true);
});
it.each(["focus", "focus-return", "owner", "generation", "storage", "background-return", "unmount"])("retires a captured link confirmation after %s changes", async scope => {
  f.history = [reply("older")]; await mount();
  await act(async () => { nodes("Markdown")[0].props.onLinkPress("https://example.test/retired"); });
  const confirm = button("Open link").props.onPress;
  if (scope === "focus" || scope === "focus-return") f.params = { workout_id: "new-workout", revision: "1" };
  if (scope === "owner") f.owner = "other-owner";
  if (scope === "generation") f.generation = 2;
  if (scope === "storage") f.current = false;
  if (scope === "unmount") await unmount(); else await refresh();
  if (scope === "focus-return") { f.params = {}; await refresh(); }
  if (scope === "background-return") {
    for (const state of ["background", "active"]) {
      await act(async () => { f.appState = state; f.foreground.forEach(listener => listener(state)); }); await settle();
    }
  }
  await act(async () => confirm()); expect(f.openURL).not.toHaveBeenCalled();
});
it("shows app feedback for an opening failure and ignores a late failure in another scope", async () => {
  f.history = [reply("older")]; f.openURL.mockRejectedValueOnce(Error("Unavailable")); await mount();
  await act(async () => { nodes("Markdown")[0].props.onLinkPress("https://example.test/unavailable"); });
  await click("Open link");
  expect(nodes("Notice").some(node => String(node.props.children).includes("could not be opened"))).toBe(true);
  const opening = deferred<void>(); f.openURL.mockReturnValueOnce(opening.promise);
  await act(async () => { nodes("Markdown")[0].props.onLinkPress("https://example.test/old"); });
  await click("Open link");
  f.params = { workout_id: "new-workout", revision: "1" }; await refresh();
  await act(async () => opening.reject(Error("Late failure"))); await settle();
  expect(nodes("Notice").some(node => String(node.props.children).includes("could not be opened"))).toBe(false);
});
it("ignores a previous route composer callback after the focus commits", async () => {
  await mount(); const staleChange = nodes("Field")[0].props.onChange;
  f.params = { workout_id: "new-workout", revision: "1" }; await refresh();
  await act(async () => staleChange("Previous route text")); await settle();
  expect(nodes("Field")[0].props.value).toBe("");
});


it("preserves a reader's newer scroll position while an older page is still loading", async () => {
  f.pageSize = 2; f.history = [reply("newer"), reply("older")];
  const gate = deferred<{ messages: CoachMessage[]; limit: number; offset: number }>(); f.historyGate = gate.promise;
  await mount(); bindScroll();
  const row = () => nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === "Question older").length)!;
  await act(async () => row().props.onLayout({ nativeEvent: { layout: { y: 500 } } }));
  await act(async () => bindScroll().props.onScroll(scrollEvent(550))); await click("Load earlier messages");
  await act(async () => bindScroll().props.onScroll(scrollEvent(650)));
  await act(async () => gate.resolve({ messages: [{ ...reply("earliest"), created_at: "2026-10-14T00:00:00Z" }], limit: 2, offset: 2 })); await settle();
  await act(async () => row().props.onLayout({ nativeEvent: { layout: { y: 900 } } }));
  expect(f.scrollTo).toHaveBeenCalledWith({ y: 1050, animated: false });
});
it("does not carry an older-page anchor into a different committed account scope", async () => {
  f.pageSize = 2; f.history = [reply("newer"), reply("older")]; await mount(); bindScroll();
  const staleLayout = nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === "Question older").length)!.props.onLayout;
  await act(async () => staleLayout({ nativeEvent: { layout: { y: 500 } } }));
  await act(async () => bindScroll().props.onScroll(scrollEvent(550))); await click("Load earlier messages");
  f.owner = "next-reader"; f.history = [reply("new-reader")]; await refresh(); bindScroll();
  await act(async () => staleLayout({ nativeEvent: { layout: { y: 900 } } }));
  expect(f.scrollTo).not.toHaveBeenCalled();
});


it("keeps the top controls in place if no existing message is visible while loading earlier history", async () => {
  f.pageSize = 2; f.history = [reply("newer"), reply("older"), { ...reply("earliest"), created_at: "2026-10-14T00:00:00Z" }];
  await mount(); bindScroll();
  const row = () => nodes("View").find(node => node.props.onLayout && node.findAll(child => String(child.type) === "Copy" && child.props.children === "Question older").length)!;
  await act(async () => row().props.onLayout({ nativeEvent: { layout: { y: 1000 } } }));
  await act(async () => bindScroll().props.onScroll(scrollEvent(0))); await click("Load earlier messages");
  await act(async () => row().props.onLayout({ nativeEvent: { layout: { y: 1400 } } }));
  await act(async () => bindScroll().props.onContentSizeChange(390, 2400));
  expect(f.scrollTo).not.toHaveBeenCalled(); expect(f.scrollEnd).not.toHaveBeenCalled();
});

it("reports resolved-false clipboard failure and clears that feedback after a confirmed retry", async () => {
  f.history = [reply("older")]; f.copy.mockResolvedValueOnce(false); await mount();
  await click("Copy reply");
  expect(nodes("Button").some(node => node.props.title === "Reply copied")).toBe(false);
  expect(nodes("Notice").some(node => String(node.props.children).includes("Could not copy"))).toBe(true);
  await click("Copy reply"); expect(button("Reply copied")).toBeTruthy();
  expect(nodes("Notice").some(node => String(node.props.children).includes("Could not copy"))).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
});
it("an uncommitted focus render cannot retire the committed conversation callback", async () => {
  f.history = [reply("older")]; const copied = deferred<boolean>(); f.copy.mockReturnValue(copied.promise);
  const Params = f.paramsContext!;
  const suspended = new Promise<never>(() => undefined);
  function Gate({ pending }: { pending: boolean }) { if (pending) throw suspended; return null; }
  const screen = (params: Record<string, string>, pending: boolean) => createElement(QueryClientProvider, { client: cache },
    createElement(Suspense, { fallback: createElement("Fallback") },
      createElement(Params.Provider, { value: params }, createElement(Coach), createElement(Gate, { pending }))));
  await act(async () => { view = create(screen({}, false)); }); await settle();
  await click("Copy reply");
  await act(async () => { startTransition(() => view!.update(screen({ workout_id: "uncommitted", revision: "1" }, true))); });
  expect(nodes("Fallback")).toHaveLength(0);
  await act(async () => copied.resolve(true)); await settle();
  expect(button("Reply copied")).toBeTruthy();
  expect(f.send).not.toHaveBeenCalled();
});

async function replaceScope(change: "owner" | "generation" | "focus" | "storage") {
  if (change === "owner") f.owner = "replacement-owner";
  else if (change === "generation") f.generation = 2;
  else if (change === "focus") f.params = { workout_id: "replacement-workout", revision: "1" };
  else f.storageVersion++;
  await refresh();
}
const showCheckIn = async () => { await act(async () => { nodes("ListRow").find(node => node.props.title === "Check in before planning or returning")!.props.onPress(); }); await settle(); };
async function clearHandler() { await click("Clear saved coach conversation"); return button("Clear conversation and pending suggestions").props.onPress as () => void; }
it.each(["owner", "generation", "focus", "storage"] as const)("rejects a retained check-in command before changing busy state or calling the prior API after %s replacement", async change => {
  await mount(); await showCheckIn(); const retained = button("Save today’s check-in").props.onPress;
  await replaceScope(change); await act(async () => retained()); await settle();
  expect(f.readiness).not.toHaveBeenCalled(); expect(nodes("Field")[0].props.disabled).toBe(false);
  await type("New scope message"); f.send.mockImplementation(async id => reply(id)); await click("Send message"); expect(f.send).toHaveBeenCalledOnce();
});
it.each(["owner", "generation", "focus", "storage"] as const)("rejects a retained Clear command before changing the new screen after %s replacement", async change => {
  await mount(); const retained = await clearHandler(); await replaceScope(change);
  await act(async () => retained()); await settle(); expect(f.clear).not.toHaveBeenCalled();
  expect(nodes("Field")[0].props.disabled).toBe(false); await type("New scope message"); f.send.mockImplementation(async id => reply(id)); await click("Send message"); expect(f.send).toHaveBeenCalledOnce();
});
it("a retained pre-Clear command cannot clear the newly committed conversation epoch", async () => {
  await mount(); const retained = await clearHandler(); await act(async () => retained()); await settle(); expect(f.clear).toHaveBeenCalledOnce();
  await type("New conversation message"); f.send.mockRejectedValue(Error("uncertain delivery")); await click("Send message"); const saved = draft();
  await act(async () => retained()); await settle(); expect(f.clear).toHaveBeenCalledOnce(); expect(draft()).toEqual(saved); expect(nodes("Field")).toHaveLength(0);
});
it.each(["owner", "generation", "focus", "storage", "clear"] as const)("a retained discarded-request command cannot erase the replacement pending UUID after %s", async change => {
  f.send.mockRejectedValueOnce(Object.assign(Error("cleared"), { status: 410 })); await mount(); await type("Old request"); await click("Send message");
  const retained = button("Discard this cleared request and write a new message").props.onPress;
  if (change === "clear") { const clear = await clearHandler(); await act(async () => clear()); await settle(); }
  else {
    await replaceScope(change);
    // Replacing the storage handle keeps its persisted journal. Resolve that
    // restored request through the NEW scope before creating the successor.
    if (change === "storage") { const clear = await clearHandler(); await act(async () => clear()); await settle(); }
  }
  f.send.mockRejectedValue(Error("uncertain delivery")); await type("Replacement message"); await click("Send message"); const summary = nodes("Copy").find(node => node.props.accessibilityLabel === "Your message: Replacement message")!; const saved = new Map(f.values);
  await act(async () => retained()); await settle(); expect(f.values).toEqual(saved); expect(nodes("Field")).toHaveLength(0); expect(nodes("Copy").find(node => node.props.accessibilityLabel === summary.props.accessibilityLabel)?.props.children).toEqual(summary.props.children);
});

it.each(["reuse", "composer", "check-in"] as const)("a retained %s command cannot alter a fresh draft after same-account Clear", async command => {
  f.history = [reply("failed", "failed")]; await mount();
  let retained: () => void;
  if (command === "reuse") retained = button("Use message again").props.onPress;
  else if (command === "composer") { const change = nodes("Field")[0].props.onChange; retained = () => change("Retired field input"); }
  else { await showCheckIn(); retained = button("Save today’s check-in").props.onPress; }
  const clear = await clearHandler(); f.clear.mockImplementation(async () => { f.history = []; }); await act(async () => clear()); await settle();
  await type("Fresh conversation draft"); const before = new Map(f.values);
  await act(async () => retained()); await settle(); expect(f.values).toEqual(before); expect(nodes("Field")[0].props.value).toBe("Fresh conversation draft");
  expect(f.readiness).not.toHaveBeenCalled(); expect(nodes("Field")[0].props.disabled).toBe(false);
});

it("renders pending empty replies without raw text in the native layout", async () => {
  f.history = [{ ...reply("waiting", "pending"), assistant_message: "" }];
  await mount();
  const row = nodes("View").find(node => node.props.onLayout)!;
  expect(row).toBeTruthy();
  expect(row.props.children.some((child: unknown) => typeof child === "string" || typeof child === "number")).toBe(false);
  expect(nodes("Markdown")).toHaveLength(0);
  expect(nodes("Notice").some(node => String(node.props.children).includes("Still processing"))).toBe(true);
});

it("a retained copy cannot write to the clipboard after the same account leaves and returns", async () => {
  f.history = [reply("older")]; await mount(); const retained = button("Copy reply").props.onPress, owner = f.owner;
  f.owner = "another-account"; await refresh(); f.owner = owner; await refresh();
  await act(async () => retained()); await settle(); expect(f.copy).not.toHaveBeenCalled();
});

it("does not send a retired request when another conversation clears the epoch during the pending journal write acknowledgement", async () => {
  await mount(); await type("Question before external Clear"); const saved = deferred<void>(); f.pendingSaveGate = saved.promise;
  await click("Send message"); expect(draft().pending).toBeTruthy(); expect(f.send).not.toHaveBeenCalled();
  f.values.set(draftKey(f.owner, "coach-reset:1"), "externally-cleared");
  f.values.delete(draftKey(f.owner, "coach-draft:1:general"));
  await act(async () => saved.resolve()); await settle();
  expect(f.send).not.toHaveBeenCalled();
});
it("retired layout and scroll callbacks cannot scroll a replacement conversation after Clear", async () => {
  f.history = [reply("older")]; await mount(); const layout = nodes("View").find(node => node.props.onLayout)!.props.onLayout;
  const resize = nodes("Screen")[0].props.onContentSizeChange, scroll = nodes("Screen")[0].props.onScroll;
  const clear = await clearHandler(); f.clear.mockImplementation(async () => { f.history = []; }); await act(async () => clear()); await settle();
  f.history = [reply("newer")]; await cache.invalidateQueries({ queryKey: [f.owner, "coach-history"] }); await settle();
  f.scrollEnd.mockClear(); f.scrollTo.mockClear();
  await act(async () => { layout({ nativeEvent: { layout: { y: 500 } } }); resize(390, 2000); scroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 600 } } }); });
  expect(f.scrollEnd).not.toHaveBeenCalled(); expect(f.scrollTo).not.toHaveBeenCalled();
  expect(button("Jump to latest reply")).toBeUndefined();
});

it.each(["receipt", "error"] as const)("an old send %s cannot overwrite a restored successor conversation after focus reload", async kind => {
  const held = deferred<void>();
  if (kind === "receipt") {
    f.send.mockImplementationOnce(async id => reply(id));
    vi.spyOn(cache, "invalidateQueries").mockImplementationOnce(() => held.promise);
  } else f.send.mockImplementationOnce(async () => { await held.promise; throw Error("Old request failed"); });
  await mount(); await type("Original question"); await click("Send message");
  f.values.set(draftKey(f.owner, "coach-reset:1"), "successor-epoch");
  f.values.set(draftKey(f.owner, "coach-draft:1:general"), JSON.stringify({ epoch: "successor-epoch", message: "Restored successor draft", pending: null }));
  f.focusVersion++; await refresh(); expect(nodes("Field")[0].props.value).toBe("Restored successor draft");
  await act(async () => held.resolve()); await settle();
  expect(nodes("Field")[0].props.value).toBe("Restored successor draft");
  expect(draft().message).toBe("Restored successor draft");
  expect(nodes("Notice").some(node => String(node.props.children).includes("Old request failed"))).toBe(false);
  expect(nodes("Field")[0].props.disabled).toBe(false);
});

it("connects the reading commands after loading becomes a ready conversation without losing its draft", async () => {
  const profile = deferred<{ adult_confirmed: boolean }>(); f.profileGate = profile.promise;
  f.history = [reply("older")];
  f.values.set(draftKey(f.owner, "coach-draft:1:general"), JSON.stringify({ message: "Keep my unsent question", pending: null }));
  await mount();
  expect(nodes("Copy").some(node => node.props.children === "Loading your training preferences…")).toBe(true);
  await act(async () => profile.resolve({ adult_confirmed: true })); await settle();
  expect(nodes("Field")[0].props.value).toBe("Keep my unsent question");
  // Do not manually bind the scroll ref: it must arrive through the mounted surface.
  await act(async () => nodes("Screen")[0].props.onScroll(scrollEvent(0)));
  expect(button("Jump to latest reply")).toBeTruthy(); f.scrollEnd.mockClear();
  await click("Jump to latest reply");
  expect(f.scrollEnd).toHaveBeenCalledWith({ animated: true });
  expect(nodes("Field")[0].props.value).toBe("Keep my unsent question");
});


it("keeps an active request compact and retries the same durable message after a delivery error", async () => {
  const answer = deferred<CoachMessage>(); f.send.mockReturnValueOnce(answer.promise);
  await mount(); const message = "A long question\nwith several lines\nand details to retain";
  await type(message); await click("Send message");
  const request = f.send.mock.calls[0];
  const footer = nodes("PinnedFooter")[0];
  expect(footer.findAll(node => String(node.type) === "Field")).toHaveLength(0);
  const summary = footer.findAll(node => String(node.type) === "Copy" && node.props.accessibilityLabel === `Your message: ${message}`)[0];
  expect(summary.props.numberOfLines).toBe(2);
  expect(draft().pending).toMatchObject({ request_id: request[0], message });
  for (const title of ["Send message", "Retry saved message", "Check for reply"]) expect(button(title)).toBeUndefined();
  await act(async () => answer.reject(Error("Connection interrupted"))); await settle();
  expect(button("Retry saved message")).toBeDefined(); expect(nodes("Field")).toHaveLength(0);
  expect(nodes("Notice").some(node => String(node.props.children).includes("Connection interrupted"))).toBe(true);
  f.send.mockImplementationOnce(async id => reply(id)); await click("Retry saved message");
  expect(f.send.mock.calls[1].slice(0, 4)).toEqual(request.slice(0, 4));
  expect(draft().pending).toBeNull(); expect(nodes("Field")[0].props.value).toBe("");
  expect(nodes("Field")[0].props.disabled).toBe(false);
});

it("only opts the Coach conversation into manual browser reading-position authority", async () => {
  const gate = deferred<{ adult_confirmed: boolean }>(); f.profileGate = gate.promise;
  await mount(); expect(nodes("Screen")[0].props.disableBrowserScrollAnchoring).not.toBe(true);
  await act(async () => gate.resolve({ adult_confirmed: true })); await settle();
  expect(nodes("Screen")[0].props.disableBrowserScrollAnchoring).toBe(true);
});
it.each(["web", "ios", "android"])("the real Screen disables browser anchoring only for opted-in web scrollers (%s)", async platform => {
  f.platform = platform as typeof f.platform;
  const { Screen } = await vi.importActual<typeof import("../components/design/surfaces")>("../components/design/surfaces");
  await act(async () => { view = create(createElement(Screen, { title: "Reading", disableBrowserScrollAnchoring: true })); });
  expect(nodes("ScrollView")[0].props.style).toEqual(platform === "web" ? { overflowAnchor: "none" } : undefined);
  await act(async () => { view!.update(createElement(Screen, { title: "Other screen" })); });
  expect(nodes("ScrollView")[0].props.style).toBeUndefined();
});


it("keeps the native photo reply nested list complete and copyable inside the real assistant bubble", async () => {
  // Actual Yoga dimensions are a separate native acceptance check. This mounts
  // the production Bubble/CoachReply composition and the exact failing content.
  f.bubble = (await vi.importActual<typeof import("../components/design/surfaces")>("../components/design/surfaces")).Bubble;
  const answer = "- **Title:** QA CIRCUIT ZEPHYR42  \n- **Duration:** 7 minutes  \n- **Format:** AMRAP \u2014 as many rounds as possible  \n- **Exercises per round:**\n  - 4 goblet squats\n  - 6 rows total \u2014 3 each side\n- **Instruction:** Repeat the sequence until 7 minutes are complete.";
  f.history = [{ ...reply("older"), assistant_message: answer }]; await mount();
  const replies = view!.root.findAllByType(f.bubble!);
  const coach = replies.find(node => node.props.from === "coach")!;
  expect(replies.map(node => node.props.from)).toEqual(["you", "coach"]);
  const bubble = coach.findAll(node => String(node.type) === "View")[1];
  const markdown = coach.findAll(node => String(node.type) === "Markdown")[0].props;
  expect(markdown.children).toBe(answer);
  const tokens = markdown.markdownit.parse(answer, {});
  expect(tokens.filter((token: { type: string }) => token.type === "bullet_list_open")).toHaveLength(2);
  expect(tokens.filter((token: { type: string }) => token.type === "inline").map((token: { content: string }) => token.content)).toContain("6 rows total — 3 each side");
  expect(bubble.children.at(-1)).toMatchObject({ props: { title: "Copy reply" } });
  await click("Copy reply"); expect(f.copy).toHaveBeenCalledWith(answer);
  expect(button("Reply copied")).toBeTruthy();
});

function savedPending(id = "saved-request", stop_requested?: true) {
  const pending = { request_id: id, message: "Keep my question", generation: f.generation, focus: {},
    created_at: new Date().toISOString(), ...(stop_requested ? { stop_requested } : {}) };
  f.values.set(draftKey(f.owner, `coach-draft:${f.generation}:general`), JSON.stringify({ message: pending.message, pending }));
  return pending;
}
const stopped = (id: string): CoachMessage => ({ ...reply(id, "failed"), cancelled: true, assistant_message: "Reply stopped." });
it("persists Stop before acknowledgement, coalesces taps, and retires only the matching send after confirmation", async () => {
  const sending = deferred<CoachMessage>(), stopping = deferred<CoachMessage>();
  f.send.mockReturnValue(sending.promise); f.stop.mockReturnValue(stopping.promise);
  await mount(); await type("My question"); await click("Send message");
  const signal = f.send.mock.calls[0][4] as AbortSignal;
  const stop = button("Stop reply");
  await act(async () => { stop.props.onPress(); stop.props.onPress(); }); await settle();
  expect(f.stop).toHaveBeenCalledExactlyOnceWith("request-1", 1);
  expect(draft().pending.stop_requested).toBe(true); expect(signal.aborted).toBe(false);
  f.history = [stopped("request-1")];
  await act(async () => stopping.resolve(f.history[0])); await settle();
  expect(signal.aborted).toBe(true); expect(draft().pending).toBeNull();
  expect(nodes("Field")[0].props.value).toBe("My question");
  await type("My next unsent draft");
  await act(async () => sending.resolve(reply("request-1"))); await settle();
  expect(nodes("Field")[0].props.value).toBe("My next unsent draft");
  expect(f.send).toHaveBeenCalledTimes(1); expect(f.uuid).toBe(1);
});
it("keeps lost Stop acknowledgement durable across remount and accepts a hidden pre-send terminal receipt", async () => {
  savedPending(); f.stop.mockRejectedValueOnce(Error("Offline")); await mount();
  const staleSend = button("Retry saved message").props.onPress; await click("Stop reply");
  expect(draft().pending.stop_requested).toBe(true);
  await act(async () => staleSend()); await settle(); expect(f.send).not.toHaveBeenCalled();
  await unmount(); await mount();
  expect(button("Retry stopping reply")).toBeTruthy();
  expect(nodes("Button").some(node => /Send message|Retry saved message|Check for reply/.test(node.props.title))).toBe(false);
  f.stop.mockResolvedValueOnce({ ...stopped("saved-request"), user_message: "", assistant_message: "" });
  await click("Retry stopping reply");
  expect(f.stop.mock.calls).toEqual([["saved-request", 1], ["saved-request", 1]]);
  expect(f.send).not.toHaveBeenCalled(); expect(draft().pending).toBeNull();
  expect(nodes("Field")[0].props.value).toBe("Keep my question");
  expect(nodes("Bubble")).toHaveLength(0);
});
it("keeps a completed-first reply and its reviewable proposal without claiming it stopped", async () => {
  savedPending();
  const completed = { ...reply("saved-request"), actions: [{ proposal_id: "review-me", kind: "schedule" as const,
    status: "ready", state: "proposed" as const }] };
  f.stop.mockImplementation(async () => { f.history = [completed]; return completed; });
  await mount(); await click("Stop reply");
  expect(draft().pending).toBeNull(); expect(nodes("Field")[0].props.value).toBe("");
  expect(nodes("Notice").some(node => String(node.props.children).includes("finished before Stop"))).toBe(true);
  expect(nodes("Notice").some(node => String(node.props.children).includes("Reply stopped"))).toBe(false);
  await click("Review schedule suggestion"); expect(f.push).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ id: "review-me" }) }));
  expect(f.send).not.toHaveBeenCalled();
});
it("stops a visible history request without replacing a separate unsent draft", async () => {
  f.history = [reply("remote", "pending")];
  f.stop.mockImplementation(async () => { f.history = [stopped("remote")]; return f.history[0]; });
  await mount(); await type("My unrelated draft"); await click("Stop this reply");
  expect(f.stop).toHaveBeenCalledExactlyOnceWith("remote", 1);
  expect(draft().message).toBe("My unrelated draft"); expect(draft().pending).toBeNull();
  expect(nodes("Bubble")[0].props.meta).toContain("Stopped"); expect(f.send).not.toHaveBeenCalled();
});
it("allows Stop after AI disable and consent revocation while Send stays disabled", async () => {
  savedPending(); f.coach = false; f.consent = false;
  f.stop.mockResolvedValueOnce(stopped("saved-request")); await mount();
  expect(button("Retry saved message").props.disabled).toBe(true);
  expect(button("Stop reply").props.disabled).toBe(false); await click("Stop reply");
  expect(f.stop).toHaveBeenCalledExactlyOnceWith("saved-request", 1); expect(f.send).not.toHaveBeenCalled();
});
it("does not offer simulated Stop on an older server or resend a restored stop intent", async () => {
  savedPending("saved-request", true); f.cancellation = undefined; await mount();
  expect(nodes("Button").some(node => /Stop reply|Retry stopping reply|Retry saved message|Send message/.test(node.props.title))).toBe(false);
  expect(f.send).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled(); expect(draft().pending.stop_requested).toBe(true);
});
it("does not call cancellation until its pending Stop intent can be stored", async () => {
  savedPending(); await mount(); f.writeFailure = true; await click("Stop reply");
  expect(f.stop).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  expect(button("Retry stopping reply")).toBeTruthy();
  f.writeFailure = false; f.stop.mockResolvedValueOnce(stopped("saved-request")); await click("Retry stopping reply");
  expect(f.stop).toHaveBeenCalledExactlyOnceWith("saved-request", 1); expect(draft().pending).toBeNull();
});
it.each(["owner", "generation", "focus"] as const)("ignores late Stop acknowledgement after %s changes", async change => {
  savedPending(); const stopping = deferred<CoachMessage>(); f.stop.mockReturnValue(stopping.promise);
  await mount(); await click("Stop reply"); const original = stopped("saved-request");
  if (change === "owner") f.owner = "new-owner";
  else if (change === "generation") f.generation = 2;
  else f.params = { workout_id: "another-workout", revision: "1" };
  await refresh(); await type("New scope draft");
  await act(async () => stopping.resolve(original)); await settle();
  expect(nodes("Field")[0].props.value).toBe("New scope draft"); expect(f.send).not.toHaveBeenCalled();
});
it("ignores late Stop after the storage lease retires or the view unmounts", async () => {
  savedPending(); const stopping = deferred<CoachMessage>(); f.stop.mockReturnValue(stopping.promise);
  await mount(); await click("Stop reply"); const before = new Map(f.values); f.current = false;
  await unmount(); await act(async () => stopping.resolve(stopped("saved-request"))); await settle();
  expect(f.values).toEqual(before); expect(f.send).not.toHaveBeenCalled();
});
it("an old conversation epoch cannot be revived by a late Stop response", async () => {
  savedPending(); const stopping = deferred<CoachMessage>(); f.stop.mockReturnValue(stopping.promise);
  await mount(); await click("Stop reply");
  f.values.set(draftKey(f.owner, "coach-reset:1"), "new-epoch");
  const key = draftKey(f.owner, "coach-draft:1:general");
  const next = JSON.stringify({ message: "New conversation", pending: null, epoch: "new-epoch" }); f.values.set(key, next);
  await act(async () => stopping.resolve(stopped("saved-request"))); await settle();
  expect(f.values.get(key)).toBe(next); expect(f.send).not.toHaveBeenCalled();
});
it("uses a confirmed terminal history outcome when the Stop response is lost", async () => {
  savedPending(); let reject!: (error: Error) => void;
  f.stop.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  await mount(); await click("Stop reply");
  f.history = [reply("saved-request")];
  await act(async () => { await cache.invalidateQueries({ queryKey: [f.owner, "coach-history"] }); }); await settle();
  await act(async () => reject(Error("Lost acknowledgement"))); await settle();
  expect(draft().pending).toBeNull();
  expect(nodes("Notice").some(node => String(node.props.children).includes("finished before Stop"))).toBe(true);
  expect(nodes("Notice").some(node => String(node.props.children).includes("may still finish"))).toBe(false);
});
it.each(["pending", "wrong-request", "wrong-generation"] as const)("does not unlock or resend on a %s cancellation response", async mismatch => {
  savedPending(); f.stop.mockResolvedValueOnce({ ...stopped(mismatch === "wrong-request" ? "different" : "saved-request"),
    ...(mismatch === "pending" ? { state: "pending" } : {}), ...(mismatch === "wrong-generation" ? { generation: 2 } : {}) });
  await mount(); await click("Stop reply");
  expect(draft().pending.stop_requested).toBe(true); expect(button("Retry stopping reply")).toBeTruthy();
  expect(f.send).not.toHaveBeenCalled(); expect(nodes("Field")).toHaveLength(0);
});

it("shows actual provisional deltas only in RAM, clears a tool turn, and exposes actions only from the canonical final receipt", async () => {
  f.streaming = true;
  let emit!: (text: string) => Promise<void>, finish!: (message: CoachMessage) => void;
  f.stream.mockImplementation((_id, _message, _focus, _generation, _signal, onText) => {
    emit = onText; return new Promise<CoachMessage>(done => { finish = done; });
  });
  await mount(); await type("Make a plan"); await click("Send message");
  await act(async () => emit("First turn preview")); await settle();
  expect(nodes("Bubble").find(node => String(node.props.meta).includes("not saved"))?.findByType("Copy" as never).props.children).toBe("First turn preview");
  expect(JSON.stringify([...f.values.values()])).not.toContain("First turn preview");
  expect(cache.getQueryData([f.owner, "coach-history", 1, "initial"])).not.toMatchObject({ assistant_message: "First turn preview" });
  expect(button("Review schedule suggestion")).toBeUndefined();
  await act(async () => emit("")); expect(nodes("Bubble").filter(node => String(node.props.meta).includes("not saved"))).toHaveLength(0);
  await act(async () => emit("Final turn preview"));
  const id = f.stream.mock.calls[0][0];
  const canonical: CoachMessage = { ...reply(id), actions: [{ proposal_id: "approved", kind: "schedule", status: "ready", state: "proposed" }] };
  f.history = [canonical]; await act(async () => finish(canonical)); await settle();
  expect(nodes("Bubble").filter(node => String(node.props.meta).includes("not saved"))).toHaveLength(0);
  expect(button("Review schedule suggestion")).toBeDefined(); expect(f.send).not.toHaveBeenCalled();
});
it("an interrupted stream discards provisional text and retries the frozen request without a JSON fallback or fresh UUID", async () => {
  f.streaming = true;
  f.stream.mockImplementationOnce(async (_id, _message, _focus, _generation, _signal, onText) => { await onText("Unsaved preview"); throw Error("Connection lost"); });
  await mount(); await type("Frozen question"); await click("Send message");
  const original = f.stream.mock.calls[0];
  expect(nodes("Bubble").filter(node => String(node.props.meta).includes("not saved"))).toHaveLength(0);
  expect(draft().pending.request_id).toBe(original[0]);
  f.stream.mockImplementationOnce(async id => reply(id)); await click("Retry saved message");
  expect(f.stream.mock.calls[1].slice(0, 4)).toEqual(original.slice(0, 4)); expect(f.uuid).toBe(1); expect(f.send).not.toHaveBeenCalled();
});
it("Stop hides provisional text immediately but only a durable matching cancellation retires the request", async () => {
  f.streaming = true;
  let emit!: (text: string) => Promise<void>;
  f.stream.mockImplementation((_id, _message, _focus, _generation, _signal, onText) => { emit = onText; return new Promise(() => {}); });
  const stopped = deferred<CoachMessage>(); f.stop.mockReturnValue(stopped.promise);
  await mount(); await type("Keep this question"); await click("Send message");
  await act(async () => emit("Unsaved")); await click("Stop reply");
  expect(draft().pending.stop_requested).toBe(true);
  expect(nodes("Bubble").filter(node => String(node.props.meta).includes("not saved"))).toHaveLength(0);
  expect(nodes("Field")).toHaveLength(0);
  await expect(emit("Late delta")).rejects.toThrow("retired");
  const id = f.stream.mock.calls[0][0];
  await act(async () => stopped.resolve({ ...reply(id, "failed"), cancelled: true })); await settle();
  expect(draft().pending).toBeNull(); expect(nodes("Field")[0].props.value).toBe("Keep this question");
});

it.each([true, false])("a canonical terminal stream replay resolves saved delivery uncertainty and restores editing for cancelled=%s", async cancelled => {
  f.streaming = true; f.stream.mockRejectedValueOnce(Error("Lost stream acknowledgment"));
  await mount(); await type("Keep my exact question"); await click("Send message");
  const original = f.stream.mock.calls[0].slice(0, 4);
  await unmount(); await mount();
  const guidance = cancelled ? "Reply stopped. No training changes were applied."
    : "I couldn't finish this request. Review your current training information and send a new message to retry.";
  f.stream.mockImplementationOnce((id, message, focus, generation, signal, onText) => {
    const terminal = { ...reply(id, "failed"), user_message: message, assistant_message: guidance, ...(cancelled ? { cancelled: true } : {}) };
    const body = new TextEncoder().encode(JSON.stringify({ type: "receipt", request_id: id, generation, receipt: terminal }) + "\n");
    const transport = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }),
      { headers: { "Content-Type": "application/x-ndjson" } }));
    return streamCoachRequest({ url: "https://example.test", headers: {}, body: { request_id: id, message, ...focus }, generation, signal,
      current: () => undefined, onText, fetchImpl: transport as unknown as NonNullable<Parameters<typeof streamCoachRequest>[0]["fetchImpl"]> });
  });
  await click("Retry saved message");
  expect(f.stream.mock.calls[1].slice(0, 4)).toEqual(original); expect(f.uuid).toBe(1); expect(f.send).not.toHaveBeenCalled();
  expect(draft().pending).toBeNull(); expect(nodes("Field")[0].props.value).toBe("Keep my exact question");
  expect(nodes("Field")[0].props.disabled).toBe(false); expect(button("Send message")).toBeDefined();
  expect(button("Retry saved message")).toBeUndefined(); expect(button("Review schedule suggestion")).toBeUndefined();
});


it("keeps canonical stopped history and one composer recovery without a redundant reuse action", async () => {
  savedPending(); const canonical = { ...stopped("saved-request"), user_message: "Keep my question", assistant_message: "Reply stopped. No training changes were applied." };
  f.stop.mockImplementationOnce(async () => { f.history = [canonical]; return canonical; }); await mount(); await click("Stop reply");
  expect(nodes("Markdown").map(node => node.props.children)).toEqual([canonical.assistant_message]);
  const footer = nodes("PinnedFooter")[0];
  const recovery = nodes("Notice").filter(node => String(node.props.children).includes("Reply stopped"));
  expect(recovery).toHaveLength(1); expect(footer.findAll(node => node === recovery[0])).toHaveLength(1);
  expect(nodes("Field")[0].props.value).toBe(canonical.user_message); expect(button("Use message again")).toBeUndefined();
  await type("A different draft"); await click("Use message again");
  expect(nodes("Field")[0].props.value).toBe("A different draft"); expect(button("Replace unsent draft")).toBeDefined();
  await click("Keep my draft"); expect(nodes("Field")[0].props.value).toBe("A different draft");
});

it("an old Stop acknowledgement cannot overwrite the successor conversation restored after external Clear", async () => {
  savedPending(); const held = deferred<CoachMessage>(); f.stop.mockReturnValueOnce(held.promise);
  await mount(); await click("Stop reply"); expect(f.stop).toHaveBeenCalledOnce();
  f.values.set(draftKey(f.owner, "coach-reset:1"), "successor-epoch");
  f.values.set(draftKey(f.owner, "coach-draft:1:general"), JSON.stringify({ epoch: "successor-epoch", message: "Successor draft", pending: null }));
  f.focusVersion++; await refresh();
  await act(async () => held.resolve(stopped("saved-request"))); await settle();
  expect(nodes("Field")[0].props.value).toBe("Successor draft"); expect(draft().message).toBe("Successor draft");
  expect(nodes("Notice").some(node => String(node.props.children).includes("Reply stopped"))).toBe(false);
});

it("a retained pre-Clear Stop command cannot cancel or overwrite the next conversation", async () => {
  savedPending(); await mount(); const oldStop = button("Stop reply").props.onPress;
  f.values.set(draftKey(f.owner, "coach-reset:1"), "successor-epoch");
  f.values.set(draftKey(f.owner, "coach-draft:1:general"), JSON.stringify({ epoch: "successor-epoch", message: "Successor draft", pending: null }));
  f.focusVersion++; await refresh(); await act(async () => oldStop()); await settle();
  expect(f.stop).not.toHaveBeenCalled(); expect(nodes("Field")[0].props.value).toBe("Successor draft");
});

it.each(["background", "storage", "epoch"] as const)("retires provisional stream callbacks after %s without losing the saved successor", async retirement => {
  f.streaming = true; const answer = deferred<CoachMessage>(); let emit!: (value: string) => Promise<void>;
  f.stream.mockImplementation((_id, _message, _focus, _generation, _signal, onText) => { emit = onText; return answer.promise; });
  await mount(); await type("Frozen request"); await click("Send message");
  const [id, , , , signal] = f.stream.mock.calls[0]; await act(async () => emit("Private unsaved preview"));
  if (retirement === "background") { f.appState = "background"; await act(async () => { for (const listener of f.foreground) listener("background"); }); }
  else if (retirement === "storage") { f.storageVersion++; await refresh(); }
  else {
    f.values.set(draftKey(f.owner, "coach-reset:1"), "successor-epoch");
    f.values.set(draftKey(f.owner, "coach-draft:1:general"), JSON.stringify({ epoch: "successor-epoch", message: "Successor draft", pending: null }));
    f.focusVersion++; await refresh();
  }
  expect((signal as AbortSignal).aborted).toBe(true);
  await expect(emit("Late private preview")).rejects.toThrow("retired");
  await act(async () => answer.resolve(reply(id))); await settle();
  expect(nodes("Bubble").some(node => String(node.props.meta).includes("not saved"))).toBe(false);
  expect(JSON.stringify([...f.values.values()])).not.toContain("Private unsaved preview");
  if (retirement === "epoch") expect(nodes("Field")[0].props.value).toBe("Successor draft");
  else expect(draft().pending.request_id).toBe(id);
});

it("keeps older-page navigation available when a canonical receipt grows the cached first page", async () => {
  f.pageSize = 2; f.history = [reply("newer"), reply("older"), { ...reply("oldest"), created_at: "2026-10-14T00:00:00Z" }];
  await mount(); vi.spyOn(cache, "invalidateQueries").mockResolvedValue(undefined);
  f.send.mockImplementationOnce(async id => reply(id)); await type("One more question"); await click("Send message");
  expect(nodes("Markdown")).toHaveLength(3); expect(button("Load earlier messages")).toBeDefined();
  await click("Load earlier messages"); expect(f.historyCalls).toContain(2);
  expect(nodes("Markdown").map(node => node.props.children)).toContain("Reply oldest");
});


it.each(["background-return", "blur-return"])("does not admit a saved send from a retired %s activation", async retirement => {
  await mount(); await type("My saved question"); const held = deferred<void>(); f.pendingSaveGate = held.promise;
  await click("Send message"); expect(f.send).not.toHaveBeenCalled(); expect(draft().pending?.message).toBe("My saved question");
  if (retirement === "background-return") {
    for (const state of ["background", "active"]) {
      f.appState = state; await act(async () => { for (const listener of f.foreground) listener(state); }); await settle();
    }
  } else {
    f.routeFocused = false; await refresh(); f.routeFocused = true; await refresh();
  }
  f.pendingSaveGate = null; await act(async () => held.resolve()); await settle();
  expect(f.send).not.toHaveBeenCalled(); expect(f.stream).not.toHaveBeenCalled();
  expect(draft().pending?.request_id).toBe("request-1");
  await click("Retry saved message"); expect(f.send).toHaveBeenCalledOnce(); expect(f.send.mock.calls[0][0]).toBe("request-1");
});

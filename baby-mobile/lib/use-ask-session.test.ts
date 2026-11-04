import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { askDraftKey, useAskSession, type AskContext } from "./use-ask-session";
import { emptyState, optimisticRecord, type Conversation, type DeviceState, type EditorDraft } from "./models";

const scope = vi.hoisted(() => ({ account: null as unknown, foreground: null as null | ((state: string) => void),
  listeners: new Set<(state: string) => void>() }));
vi.mock("./context", () => ({ useBaby: () => scope.account }));
vi.mock("react-native", () => ({ AppState: { addEventListener: (_: string, fn: (s: string) => void) => {
  scope.listeners.add(fn);
  scope.foreground = state => { for (const listener of scope.listeners) listener(state); };
  return { remove() { scope.listeners.delete(fn); } };
} } }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `unique-${++id}` }; });
let result: ReturnType<typeof useAskSession>, renderer: ReactTestRenderer | undefined;
const general: AskContext = { scope: "all", record_id: null, child_id: null };
function Probe({ recordId }: { recordId?: string }) { result = useAskSession(recordId); return null; }
const screens = new Map<string, ReturnType<typeof useAskSession>>();
function ScreenProbe({ name, focused, recordId }: { name: string; focused: boolean; recordId?: string }) {
  screens.set(name, useAskSession(recordId, focused)); return null;
}
function Dual({ pushed = false }: { pushed?: boolean }) {
  return React.createElement(React.Fragment, null,
    React.createElement(ScreenProbe, { name: "tab", focused: !pushed }),
    pushed ? React.createElement(ScreenProbe, { name: "entry", focused: true, recordId: "entry" }) : null);
}
function held<T>() { let release!: (value: T) => void; const promise = new Promise<T>((resolve) => { release = resolve; }); return { promise, release }; }
const row = (id = "entry", child_id: string | null = null) => optimisticRecord({
  id, child_id, kind: "source", title: "Saved advice", occurred_at: "2026-10-20T00:00:00Z", body: "", data: {},
});
const conversation = (context: AskContext, id = "history"): Conversation => ({
  id, ...context, messages: [{ role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier answer" }],
});
function setup() {
  let lease = 1;
  const account = {
    owner: "parent", current: () => true,
    state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: true,
      profile: { display_name: "Parent", timezone: "Pacific/Guam", ai_consent: true }, children: [] } } as DeviceState,
    records: [] as ReturnType<typeof row>[],
    api: {
      lease: () => lease,
      record: vi.fn(async (id: string) => row(id)),
      conversations: vi.fn(async () => ({ items: [conversation(general)] })),
      conversation: vi.fn(async (id: string) => conversation(general, id)),
      chat: vi.fn(async (_body: Record<string, unknown>, _generation: number) => ({ conversation_id: "answer-conversation", message: "Answer", citations: [] })),
    },
    saveDraft: vi.fn(async (key: string, draft: EditorDraft | null, valid?: () => boolean) => {
      if (valid && !valid()) return;
      const drafts = { ...account.state.drafts }; if (draft) drafts[key] = draft; else delete drafts[key];
      account.state = { ...account.state, drafts };
    }),
    retire: () => { lease++; },
  };
  scope.account = account;
  return account;
}
async function mount(recordId?: string) { await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { recordId })); }); }
async function render(recordId?: string) { await act(async () => renderer!.update(React.createElement(Probe, { recordId }))); }
async function question(text = "Follow up") { await act(async () => result.setQuestion(text)); }
beforeEach(() => {
  screens.clear(); scope.listeners.clear();
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
});

it.each(["general", "history"])("keeps the newer %s draft across tab → focused Ask → Back → background/relaunch (M3)", async context => {
  const account = setup();
  await act(async () => { renderer = TestRenderer.create(React.createElement(Dual)); });
  if (context === "history") await act(async () => screens.get("tab")!.load("history"));
  await act(async () => screens.get("tab")!.setQuestion("Original tab draft"));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await act(async () => renderer!.update(React.createElement(Dual, { pushed: true })));
  if (context === "history") await act(async () => screens.get("entry")!.load("history"));
  else await act(async () => screens.get("entry")!.selectScope("all"));
  await act(async () => screens.get("entry")!.setQuestion("Newer focused-screen draft"));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await act(async () => renderer!.update(React.createElement(Dual)));
  expect(screens.get("tab")!.question).toBe("Newer focused-screen draft");
  await act(async () => scope.foreground!("background"));
  const key = askDraftKey(general, context === "history" ? "history" : undefined);
  expect(account.state.drafts[key]?.body).toBe("Newer focused-screen draft");
  await act(async () => renderer!.unmount());
  await mount();
  if (context === "history") await act(async () => result.load("history"));
  expect(result.question).toBe("Newer focused-screen draft");
});

it("does not let a hidden focused-screen send clear a newer tab draft (M3)", async () => {
  const account = setup(), pending = held<Awaited<ReturnType<typeof account.api.chat>>>();
  account.api.chat.mockReturnValueOnce(pending.promise);
  await act(async () => { renderer = TestRenderer.create(React.createElement(Dual)); });
  await act(async () => renderer!.update(React.createElement(Dual, { pushed: true })));
  await act(async () => screens.get("entry")!.selectScope("all"));
  await act(async () => screens.get("entry")!.setQuestion("Question in flight"));
  let sending!: Promise<void>; await act(async () => { sending = screens.get("entry")!.send(); });
  await act(async () => renderer!.update(React.createElement(Dual)));
  expect(screens.get("tab")!.question).toBe("Question in flight");
  await act(async () => screens.get("tab")!.setQuestion("Newer tab draft"));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await act(async () => { pending.release({ conversation_id: "sent", message: "Old answer", citations: [] }); await sending; });
  expect(account.state.drafts[askDraftKey(general)]?.body).toBe("Newer tab draft");
  expect(screens.get("tab")!.messages).toEqual([]);
});

it("rejects a queued older owner write after a focused screen takes over (M3)", async () => {
  const account = setup(), pending = held<void>(), persist = account.saveDraft.getMockImplementation()!;
  account.saveDraft.mockImplementationOnce(async (...args) => { await pending.promise; return persist(...args); });
  await act(async () => { renderer = TestRenderer.create(React.createElement(Dual)); });
  await act(async () => screens.get("tab")!.setQuestion("Delayed old draft"));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await act(async () => renderer!.update(React.createElement(Dual, { pushed: true })));
  await act(async () => screens.get("entry")!.selectScope("all"));
  await act(async () => screens.get("entry")!.setQuestion("New focused draft"));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await act(async () => pending.release(undefined));
  expect(account.state.drafts[askDraftKey(general)]?.body).toBe("New focused draft");
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

it("starts a general new chat from an old care conversation, from History, without losing a draft", async () => {
  const account = setup();
  account.api.conversation.mockResolvedValue(conversation({ scope: "care", record_id: null, child_id: null }, "old"));
  await mount();
  await act(async () => result.load("old"));
  expect(result.messages).toHaveLength(2);
  await act(async () => { await result.openHistory(); });
  expect(result.showHistory).toBe(true);
  await act(async () => result.startNew());
  expect(result.showHistory).toBe(false);
  expect(result.messages).toEqual([]);
  expect(result.conversation).toBeUndefined();
  expect(result.context).toEqual(general);
  await question("Fresh question");
  await act(async () => { await result.send(); });
  expect(account.api.chat.mock.calls[0][0]).toMatchObject({ scope: "all", conversation_id: undefined, message: "Fresh question" });
});

it("keeps a new chat on the entry a focused screen opened for", async () => {
  const account = setup();
  await mount("entry");
  await question("About this");
  await act(async () => { await result.send(); });
  expect(result.conversation).toBe("answer-conversation");
  await act(async () => result.startNew());
  expect(result.messages).toEqual([]);
  expect(result.conversation).toBeUndefined();
  expect(result.context.record_id).toBe("entry");
  expect(result.focusedTitle).toBe("Saved advice");
  await question("Another");
  await act(async () => { await result.send(); });
  expect(account.api.chat.mock.calls[1][0]).toMatchObject({ record_id: "entry", conversation_id: undefined });
});

it("ignores New chat while an answer is on its way", async () => {
  const account = setup(), pending = held<Awaited<ReturnType<typeof account.api.chat>>>();
  account.api.chat.mockReturnValueOnce(pending.promise);
  await mount();
  await question("In flight");
  let sending!: Promise<void>; await act(async () => { sending = result.send(); });
  await act(async () => result.startNew());
  await act(async () => { pending.release({ conversation_id: "kept", message: "Answer", citations: [] }); await sending; });
  expect(result.conversation).toBe("kept");
  expect(result.messages.map((m) => m.content)).toEqual(["In flight", "Answer"]);
});

it("restores scope/record/child metadata before a history follow-up, matching the real API context contract", async () => {
  const account = setup(), context: AskContext = { scope: "care", record_id: null, child_id: "other-child" };
  account.api.conversation.mockResolvedValue(conversation(context));
  account.api.chat.mockImplementation(async (body) => {
    if (body.scope !== context.scope || body.child_id !== context.child_id || body.record_id != null)
      throw Error("409 Conversation context changed");
    return { conversation_id: "history", message: "Correct followup", citations: [] };
  });
  await mount();
  await act(async () => result.load("history"));
  await question(); await act(async () => result.send());
  expect(result.error).toBe("");
  expect(account.api.chat.mock.calls[0][0]).toMatchObject({ conversation_id: "history", scope: "care", child_id: "other-child" });
  expect(result.messages.map((message) => message.content)).toEqual(["Earlier question", "Earlier answer", "Follow up", "Correct followup"]);
});
it("restores a focused history record not in cache and reviews proposals for its child, not the global filter", async () => {
  const account = setup(), context: AskContext = { scope: "all", record_id: "old-entry", child_id: "history-child" };
  account.state.selectedChild = "global-child";
  account.api.conversation.mockResolvedValue(conversation(context));
  await mount(); await act(async () => result.load("history"));
  await question(); await act(async () => result.send());
  expect(account.api.chat.mock.calls[0][0]).toMatchObject({ record_id: "old-entry", child_id: "history-child" });
  await act(async () => { await result.review({ kind: "routine", title: "Chosen plan", body: "", data: { enabled: true } }); });
  const proposal = account.saveDraft.mock.calls.find(([key]) => key.startsWith("proposal:"))![1]!;
  expect(proposal.child_id).toBe("history-child");
  expect(proposal.data.enabled).toBe(false);
});
it("resolves an uncached general entry before sending, overriding a selected child's filter and old scope", async () => {
  const account = setup(); account.state.selectedChild = "selected-child";
  await mount(); await act(async () => result.selectScope("care"));
  const pending = held<ReturnType<typeof row>>(); account.api.record.mockReturnValue(pending.promise);
  await render("old-general-entry");
  expect(result.resolving).toBe(true);
  await act(async () => result.send()); expect(account.api.chat).not.toHaveBeenCalled();
  await act(async () => pending.release(row("old-general-entry", null)));
  expect(result.context).toEqual({ scope: "all", record_id: "old-general-entry", child_id: null });
  await question(); await act(async () => result.send());
  expect(account.api.chat.mock.calls[0][0]).toMatchObject({ scope: "all", record_id: "old-general-entry", child_id: null });
});
it("retries a failed focused-record lookup without sending an unverified child context", async () => {
  const account = setup(); account.api.record.mockRejectedValueOnce(Error("offline"));
  await mount("entry"); expect(result.error).toContain("offline"); expect(result.resolving).toBe(true);
  await act(async () => result.retryFocus());
  expect(result.resolving).toBe(false);
  expect(result.context.record_id).toBe("entry");
});
it("refreshes cached focus metadata after a source was reassigned or detached from a child", async () => {
  const account = setup();
  account.state.selectedChild = "old-child";
  account.records = [row("entry", "old-child")];
  account.api.record.mockResolvedValue(row("entry", null));
  await mount("entry"); await question(); await act(async () => result.send());
  expect(account.api.record).toHaveBeenCalledWith("entry");
  expect(account.api.chat.mock.calls[0][0]).toMatchObject({ record_id: "entry", child_id: null, scope: "all" });
});
it("retires late sends when another conversation loads, leaving each question in its own context", async () => {
  const account = setup(), pending = held<Awaited<ReturnType<typeof account.api.chat>>>();
  account.api.chat.mockReturnValueOnce(pending.promise);
  account.api.conversation.mockResolvedValue(conversation({ ...general, scope: "care" }, "loaded"));
  await mount(); await question("Original question");
  let sending!: Promise<void>; await act(async () => { sending = result.send(); });
  await act(async () => result.load("loaded"));
  await act(async () => { pending.release({ conversation_id: "old", message: "Wrong context answer", citations: [] }); await sending; });
  expect(result.conversation).toBe("loaded");
  expect(result.messages.map((message) => message.content)).toEqual(["Earlier question", "Earlier answer"]);
  expect(account.state.drafts[askDraftKey(general)]?.body).toBe("Original question");
});
it("discards out-of-order conversation loads and focused-entry resolutions", async () => {
  const account = setup(), old = held<Conversation>();
  account.api.conversation.mockReturnValueOnce(old.promise);
  await mount(); let loading!: Promise<void>; await act(async () => { loading = result.load("old"); });
  await act(async () => result.load("new"));
  await act(async () => { old.release(conversation({ ...general, scope: "care" }, "old")); await loading; });
  expect(result.conversation).toBe("new");
  const entry = held<ReturnType<typeof row>>(); account.api.record.mockReturnValueOnce(entry.promise);
  await render("old-entry"); await render("new-entry");
  await act(async () => entry.release(row("old-entry", "wrong-child")));
  expect(result.context).toEqual({ ...general, record_id: "new-entry" });
});
it.each(["child", "generation", "consent", "owner", "unmount"])("fences a held answer on %s change", async (change) => {
  const account = setup(), pending = held<Awaited<ReturnType<typeof account.api.chat>>>();
  account.api.chat.mockReturnValue(pending.promise);
  await mount(); await question(); let sending!: Promise<void>;
  await act(async () => { sending = result.send(); });
  if (change === "child") account.state = { ...account.state, selectedChild: "another-child" };
  if (change === "generation") { account.retire(); account.state = { ...emptyState(), bootstrap: { ...account.state.bootstrap!, generation: 2 } }; }
  if (change === "consent") account.state = { ...account.state, bootstrap: { ...account.state.bootstrap!, profile: { ...account.state.bootstrap!.profile, ai_consent: false } } };
  if (change === "owner") { const next = setup(); next.owner = "next-parent"; }
  if (change === "unmount") { await act(async () => renderer!.unmount()); renderer = undefined; }
  else await render();
  await act(async () => { pending.release({ conversation_id: "old", message: "Obsolete answer", citations: [] }); await sending; });
  expect(result.messages.some((message) => message.content === "Obsolete answer")).toBe(false);
});
it.each(["scope", "child", "consent", "generation", "owner"])("fences late history-list responses after %s changes", async (change) => {
  const account = setup(), pending = held<{ items: Conversation[] }>();
  account.api.conversations.mockReturnValue(pending.promise);
  await mount(); let listing!: Promise<void>; await act(async () => { listing = result.openHistory(); });
  if (change === "scope") await act(async () => result.selectScope("care"));
  else {
    if (change === "child") account.state = { ...account.state, selectedChild: "other-child" };
    if (change === "consent") account.state = { ...account.state, bootstrap: { ...account.state.bootstrap!, profile: { ...account.state.bootstrap!.profile, ai_consent: false } } };
    if (change === "generation") { account.retire(); account.state = { ...emptyState(), bootstrap: { ...account.state.bootstrap!, generation: 2 } }; }
    if (change === "owner") { const next = setup(); next.owner = "new-parent"; }
    await render();
  }
  await act(async () => { pending.release({ items: [conversation(general)] }); await listing; });
  expect(result.history).toEqual([]);
});
it("preserves immediate unsent drafts across scopes and children, keeping retry IDs only for identical context", async () => {
  const account = setup(); account.api.chat.mockRejectedValue(Error("offline"));
  await mount(); await question("For general context"); await act(async () => result.send());
  const firstId = account.api.chat.mock.calls[0][0].request_id;
  await act(async () => result.selectScope("care")); await question("Care draft");
  await act(async () => result.selectScope("all"));
  expect(result.question).toBe("For general context"); expect(result.requestId).toBe(firstId);
  await act(async () => result.send()); expect(account.api.chat.mock.calls[1][0].request_id).toBe(firstId);
  account.state = { ...account.state, selectedChild: "child" }; await render();
  expect(result.question).toBe(""); await question("Child draft"); await act(async () => result.send());
  expect(account.api.chat.mock.calls[2][0].request_id).not.toBe(firstId);
  account.state = { ...account.state, selectedChild: null }; await render();
  expect(result.question).toBe("For general context");
  expect(account.state.drafts[askDraftKey({ ...general, child_id: "child" })]?.body).toBe("Child draft");
});
it("restores persisted retry IDs after restart and clears the saved draft after a successful replay", async () => {
  const account = setup();
  account.state.drafts[askDraftKey(general)] = { id: "draft", kind: "journal", title: "Unsent question", body: "Saved question", child_id: null,
    occurred_at: "2026-10-20T00:00:00Z", files: [], data: { ...general, request_id: "durable-request" } };
  await mount(); expect(result.question).toBe("Saved question");
  await act(async () => result.send());
  expect(account.api.chat.mock.calls[0][0].request_id).toBe("durable-request");
  expect(account.state.drafts[askDraftKey(general)]).toBeUndefined();
  expect(result.question).toBe("");
});
it("flushes the latest unsent text on background/unmount and never double-submits synchronously", async () => {
  const account = setup(), pending = held<Awaited<ReturnType<typeof account.api.chat>>>();
  account.api.chat.mockReturnValue(pending.promise);
  await mount(); await question("Latest text");
  await act(async () => scope.foreground!("background"));
  expect(account.state.drafts[askDraftKey(general)]?.body).toBe("Latest text");
  let sending!: Promise<void>; await act(async () => { sending = result.send(); void result.send(); });
  expect(account.api.chat).toHaveBeenCalledOnce();
  await act(async () => { pending.release({ conversation_id: "answer", message: "Answer", citations: [] }); await sending; });
});

it("proposal review preserves a held answer and the send guard", async () => {
  const a=setup(), pending=held<Awaited<ReturnType<typeof a.api.chat>>>(); a.api.chat.mockReturnValue(pending.promise);
  await mount(); await question("Pending followup"); let first!:Promise<void>,second!:Promise<void>;
  await act(async()=>{first=result.send();});
  await act(async()=>{await result.review({kind:"routine",title:"Earlier proposal",body:"",data:{}});});
  const busy=result.busy;
  await act(async()=>{second=result.send();}); const calls=a.api.chat.mock.calls.length;
  await act(async()=>{pending.release({conversation_id:"same",message:"Preserved answer",citations:[]});await Promise.all([first,second]);});
  expect(busy).toBe(true); expect(calls).toBe(1);
  expect(result.messages.map(m=>m.content)).toEqual(["Pending followup","Preserved answer"]);
  expect(a.state.drafts[askDraftKey(general)]).toBeUndefined();
});
it("proposal review preserves a held conversation load", async () => {
  const a=setup(), pending=held<Conversation>(); a.api.conversation.mockReturnValue(pending.promise);
  await mount(); let loading!:Promise<void>; await act(async()=>{loading=result.load("history");});
  await act(async()=>{await result.review({kind:"routine",title:"Earlier proposal",body:"",data:{}});}); const busy=result.busy;
  await act(async()=>{pending.release(conversation({...general,scope:"care"},"history"));await loading;});
  expect(busy).toBe(true); expect(result.conversation).toBe("history"); expect(result.context.scope).toBe("care");
});

it("leaves History on Send so the pending conversation and answer are visible", async () => {
  const account = setup(), pending = held<Awaited<ReturnType<typeof account.api.chat>>>();
  account.api.chat.mockReturnValueOnce(pending.promise);
  await mount();
  await question("Find my packing notes");
  await act(async () => result.openHistory());
  expect(result.showHistory).toBe(true);
  let sending!: Promise<void>;
  await act(async () => { sending = result.send(); });
  expect(result.showHistory).toBe(false);
  expect(result.busy).toBe(true);
  await act(async () => {
    pending.release({ conversation_id: "answer", message: "Your packing notes are here.", citations: [] });
    await sending;
  });
  expect(result.showHistory).toBe(false);
  expect(result.messages.map(message => message.content)).toEqual(["Find my packing notes", "Your packing notes are here."]);
});

it("shows an urgent reply that couldn't be saved, and the next question starts a new chat", async () => {
  const account = setup();
  account.api.chat.mockResolvedValueOnce({ conversation_id: null, message: "Call 911", citations: [], help: "baby_unwell" } as never);
  await mount();
  await question("My baby is not breathing");
  await act(async () => { await result.send(); });
  expect(result.messages[1]).toMatchObject({ content: "Call 911", help: "baby_unwell" });
  expect(result.conversation).toBeUndefined();
});
function withNewAsk(account: ReturnType<typeof setup>, acknowledged: number | undefined) {
  Object.assign(account.api, { renameConversation: vi.fn(async (_id: string, title: string) => ({ title })), deleteConversation: vi.fn(async () => undefined) });
  account.state = { ...account.state, bootstrap: { ...account.state.bootstrap!, ask_consent_version: 1,
    profile: { ...account.state.bootstrap!.profile, ai_consent_version: acknowledged } } };
  return account.api as typeof account.api & { renameConversation: ReturnType<typeof vi.fn>; deleteConversation: ReturnType<typeof vi.fn> };
}

it.each([[1, true], [0, false], [undefined, false]])("asks for the new Ask when version %s is acknowledged: %s", async (acknowledged, expected) => {
  const account = setup();
  withNewAsk(account, acknowledged);
  await mount();
  await question();
  await act(async () => { await result.send(); });
  const body = account.api.chat.mock.calls[0][0];
  expect("ask_v2" in body).toBe(expected);
});

it("keeps an answer's sources and help with its message", async () => {
  const account = setup(), sources = [{ url: "https://www.cdc.gov/x", title: "CDC", domain: "www.cdc.gov", ref: "S1" }];
  account.api.chat.mockResolvedValueOnce({ conversation_id: "c", message: "Answer [S1]", citations: [], sources, help: "harm" } as never);
  await mount();
  await question();
  await act(async () => { await result.send(); });
  expect(result.messages[1]).toMatchObject({ sources, help: "harm" });
});

it("deleting the open conversation returns to a new chat, with its messages gone", async () => {
  const account = setup(), api = withNewAsk(account, 1);
  await mount();
  await act(async () => result.load("history"));
  expect(result.messages).toHaveLength(2);
  await act(async () => { expect(await result.deleteConversation("history")).toBe(true); });
  expect(api.deleteConversation).toHaveBeenCalledWith("history", 1);
  expect(result.messages).toEqual([]);
  expect(result.conversation).toBeUndefined();
});

it("deleting another conversation leaves this one open and takes it off the list", async () => {
  const account = setup();
  withNewAsk(account, 1);
  await mount();
  await act(async () => result.load("history"));
  await act(async () => { await result.openHistory(); });
  expect(result.history.map((item) => item.id)).toEqual(["history"]);
  await act(async () => { await result.deleteConversation("history"); });
  expect(result.history).toEqual([]);
});

it("treats an already-deleted conversation as deleted, and reports other failures", async () => {
  const account = setup(), api = withNewAsk(account, 1);
  const { ApiError } = await import("./api");
  await mount();
  api.deleteConversation.mockRejectedValueOnce(new ApiError("Item unavailable", 404));
  await act(async () => { expect(await result.deleteConversation("gone")).toBe(true); });
  expect(result.error).toBe("");
  api.deleteConversation.mockRejectedValueOnce(new ApiError("Couldn't reach the service", 503));
  await act(async () => { expect(await result.deleteConversation("x")).toBe(false); });
  expect(result.error).not.toBe("");
});

it("renames in the list and reports a failure", async () => {
  const account = setup(), api = withNewAsk(account, 1);
  await mount();
  await act(async () => { await result.openHistory(); });
  await act(async () => { expect(await result.renameConversation("history", "Latch help")).toBe(true); });
  expect(api.renameConversation).toHaveBeenCalledWith("history", "Latch help", 1);
  expect(result.history[0].title).toBe("Latch help");
  api.renameConversation.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { expect(await result.renameConversation("history", "Other")).toBe(false); });
  expect(result.history[0].title).toBe("Latch help");
});

it("a day's chat sends its date only to the new Ask, and keeps its own draft", async () => {
  const account = setup();
  withNewAsk(account, 1);
  await act(async () => { renderer = TestRenderer.create(React.createElement(function Day() { result = useAskSession(undefined, true, "2026-11-03"); return null; })); });
  await question("How was this day?");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(account.state.drafts[askDraftKey({ ...general, focus_date: "2026-11-03" })]?.body).toBe("How was this day?");
  expect(account.state.drafts[askDraftKey(general)]).toBeUndefined();
  await act(async () => { await result.send(); });
  expect(account.api.chat.mock.calls[0][0]).toMatchObject({ ask_v2: true, focus_date: "2026-11-03" });
});

it("without the new Ask a day's chat sends no date", async () => {
  const account = setup();
  await act(async () => { renderer = TestRenderer.create(React.createElement(function Day() { result = useAskSession(undefined, true, "2026-11-03"); return null; })); });
  await question("How was this day?");
  await act(async () => { await result.send(); });
  expect("focus_date" in account.api.chat.mock.calls[0][0]).toBe(false);
});

it("a suggested event opens for review on its own date, and nothing saves until then", async () => {
  const account = setup();
  await mount();
  await act(async () => { await result.review({ kind: "journal", title: "T", body: "", data: {}, occurred_at: "2026-11-12T09:30:00+10:00" }); });
  const saved = Object.values(account.state.drafts)[0];
  expect(saved.occurred_at).toBe("2026-11-12T09:30:00+10:00");
  expect(account.api.chat).not.toHaveBeenCalled();
});

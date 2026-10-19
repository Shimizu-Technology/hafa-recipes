import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "./context";
import { messageFor, type ChatMessage, type Conversation, type EditorDraft, type Proposal, type Scope } from "./models";

export interface AskContext { scope: Scope; record_id: string | null; child_id: string | null }
export function askDraftKey(context: AskContext, conversation?: string) {
  return "chat:v2:" + JSON.stringify([context.scope, context.record_id, context.child_id, conversation ?? null]);
}
interface Session {
  context: AskContext;
  conversation?: string;
  messages: ChatMessage[];
  question: string;
  requestId?: string;
  focusedTitle?: string;
  resolving: boolean;
}
type Account = ReturnType<typeof useBaby>;
export function useAskSession(recordId?: string) {
  const [attempt, setAttempt] = useState(0);
  const b = useBaby(),
    key = JSON.stringify([b.owner, b.state.bootstrap?.generation, b.api.lease(),
      b.state.bootstrap?.profile.ai_consent, b.state.selectedChild, recordId ?? null, attempt]);
  const live = useRef({ b, key });
  live.current = { b, key };
  const mounted = useRef(true), sequence = useRef(0), initialized = useRef(false), working = useRef(false), historyRequest = useRef(0),
    memory = useRef(new Map<string, { question: string; requestId?: string }>());
  const initial: Session = {
    context: { scope: "all", record_id: recordId ?? null, child_id: b.state.selectedChild },
    messages: [], question: "", resolving: !!recordId,
  };
  const [session, setSession] = useState<Session>(initial),
    [history, setHistory] = useState<Conversation[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = useRef(session), activeAccount = useRef(b), activeKey = useRef(key);
  function update(next: Session) { current.current = next; setSession(next); }
  const memoryKey = (account: Account, snapshot: Session) =>
    JSON.stringify([account.owner, account.state.bootstrap?.generation, askDraftKey(snapshot.context, snapshot.conversation)]);
  function draft(snapshot: Session): EditorDraft | null {
    return snapshot.question.trim() ? {
      id: Crypto.randomUUID(), kind: "journal", title: "Unsent question", body: snapshot.question,
      child_id: snapshot.context.child_id, occurred_at: new Date().toISOString(),
      data: { ...snapshot.context, request_id: snapshot.requestId }, files: [],
    } : null;
  }
  function save(snapshot: Session, account = activeAccount.current) {
    memory.current.set(memoryKey(account, snapshot), { question: snapshot.question, requestId: snapshot.requestId });
    if (!account.current() || account.owner !== live.current.b.owner || account.api !== live.current.b.api ||
      account.state.bootstrap?.generation !== live.current.b.state.bootstrap?.generation) return Promise.resolve();
    return account.saveDraft(askDraftKey(snapshot.context, snapshot.conversation), draft(snapshot));
  }
  function sameAccount(account: Account) {
    return mounted.current && account.current() && account.owner === live.current.b.owner &&
      account.api === live.current.b.api && account.state.bootstrap?.generation === live.current.b.state.bootstrap?.generation;
  }
  function stash() {
    const snapshot = current.current, account = activeAccount.current;
    if (snapshot.resolving) return;
    void save(snapshot, account).catch(() => {
      if (sameAccount(account)) setError("Your question is still on this screen, but could not be saved on this device. Return to its context and try again.");
    });
  }
  function restored(context: AskContext, conversation?: string): Pick<Session, "question" | "requestId"> {
    const account = live.current.b,
      snapshot = { ...current.current, context, conversation },
      cached = memory.current.get(memoryKey(account, snapshot)),
      saved = account.state.drafts[askDraftKey(context, conversation)];
    if (cached) return cached;
    if (saved) return { question: saved.body, requestId: typeof saved.data.request_id === "string" ? saved.data.request_id : undefined };
    // Read old app drafts without reusing an idempotency key with corrected context.
    const legacy = account.state.drafts["chat:" + String(context.record_id ?? conversation ?? context.scope)];
    return legacy && (context.record_id || legacy.child_id === context.child_id)
      ? { question: legacy.body } : { question: "" };
  }
  function ticket(advance = true) {
    const account = live.current.b, capturedKey = live.current.key, lease = account.api.lease(),
      nonce = advance ? ++sequence.current : sequence.current;
    return {
      account,
      valid: () => mounted.current && nonce === sequence.current && capturedKey === live.current.key &&
        account.current() && live.current.b.api === account.api && live.current.b.owner === account.owner &&
        account.api.lease() === lease,
    };
  }
  function activate(context: AskContext, conversation?: string, messages: ChatMessage[] = [], title?: string) {
    activeAccount.current = live.current.b;
    update({ context, conversation, messages, ...restored(context, conversation), focusedTitle: title, resolving: false });
    working.current = false; setBusy(false); setError("");
  }
  useEffect(() => {
    if (initialized.current) stash();
    initialized.current = true;
    activeKey.current = key;
    const operation = ticket(), account = operation.account;
    setHistory([]); setShowHistory(false); setError("");
    const row = account.records.find((item) => item.id === recordId);
    if (!recordId) {
      activate({ scope: "all", record_id: null, child_id: account.state.selectedChild });
      return;
    }
    activeAccount.current = account;
    // A cached entry can have been reassigned or detached from a deleted child.
    // Resolve current ownership metadata before choosing the AI context.
    update({ ...initial, focusedTitle: row?.title, question: "", resolving: true });
    working.current = true; setBusy(true);
    void account.api.record(recordId).then((row) => {
      if (operation.valid()) activate({ scope: "all", record_id: row.id, child_id: row.child_id }, undefined, [], row.title);
    }).catch((failure) => { if (operation.valid()) setError(messageFor(failure)); })
      .finally(() => { if (operation.valid()) { working.current = false; setBusy(false); } });
  }, [key]);
  useEffect(() => {
    if (session.resolving) return;
    const snapshot = session, account = activeAccount.current;
    const timer = setTimeout(() => {
      void save(snapshot, account).catch(() => {
        if (sameAccount(account)) setError("Your question has not been saved on this device. Keep this screen open and try again.");
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [session.question, session.requestId, session.context, session.conversation, session.resolving]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", (state) => { if (state !== "active") stash(); });
    return () => { stash(); mounted.current = false; sequence.current++; listener.remove(); };
  }, []);
  function selectScope(scope: Scope) {
    stash(); sequence.current++;
    activate({ scope, record_id: null, child_id: live.current.b.state.selectedChild });
  }
  async function send() {
    const snapshot = current.current, account = live.current.b;
    if (working.current || snapshot.resolving || !snapshot.question.trim() || activeKey.current !== live.current.key) return;
    if (!account.state.bootstrap?.profile.ai_consent) { setError("Enable optional AI processing in Settings first."); return; }
    const operation = ticket(), requestId = snapshot.requestId ?? Crypto.randomUUID(), text = snapshot.question.trim(),
      sent = { ...snapshot, question: text, requestId };
    update(sent); working.current = true; setBusy(true); setError("");
    try {
      await save(sent, account);
      if (!operation.valid()) return;
      const result = await account.api.chat({ ...snapshot.context,
        record_id: snapshot.context.record_id ?? undefined, conversation_id: snapshot.conversation,
        request_id: requestId, message: text }, account.state.bootstrap!.generation);
      if (!operation.valid()) return;
      await account.saveDraft(askDraftKey(snapshot.context, snapshot.conversation), null);
      if (!operation.valid()) return;
      memory.current.delete(memoryKey(account, snapshot));
      update({ ...snapshot, conversation: result.conversation_id, question: "", requestId: undefined,
        messages: [...snapshot.messages, { role: "user", content: text },
          { role: "assistant", content: result.message, citations: result.citations, proposal: result.proposal }] });
    } catch (failure) { if (operation.valid()) setError(messageFor(failure)); }
    finally { if (operation.valid()) { working.current = false; setBusy(false); } }
  }
  async function openHistory() {
    const number = ++historyRequest.current;
    if (showHistory) { setShowHistory(false); return; }
    const operation = ticket(false);
    setShowHistory(true); setError("");
    try { const result = await operation.account.api.conversations(); if (operation.valid() && number === historyRequest.current) setHistory(result.items); }
    catch (failure) { if (operation.valid() && number === historyRequest.current) setError(messageFor(failure)); }
  }
  async function load(id: string) {
    stash(); const operation = ticket();
    working.current = true; setBusy(true); setError("");
    try {
      const result = await operation.account.api.conversation(id);
      if (!operation.valid()) return;
      const context: AskContext = { scope: result.scope, record_id: result.record_id, child_id: result.child_id };
      activate(context, id, result.messages ?? [], operation.account.records.find((row) => row.id === context.record_id)?.title);
      setShowHistory(false);
    } catch (failure) { if (operation.valid()) setError(messageFor(failure)); }
    finally { if (operation.valid()) { working.current = false; setBusy(false); } }
  }
  async function review(proposal: Proposal) {
    const operation = ticket(), id = Crypto.randomUUID(), key = "proposal:" + id;
    working.current = false; setBusy(false);
    const value: EditorDraft = { id, kind: proposal.kind, title: proposal.title, body: proposal.body,
      child_id: current.current.context.child_id, occurred_at: new Date().toISOString(),
      data: { ...proposal.data, ...(proposal.kind === "routine" ? { enabled: false } : {}) }, files: [] };
    try { await operation.account.saveDraft(key, value); if (operation.valid()) return { key, kind: proposal.kind }; }
    catch (failure) { if (operation.valid()) setError(messageFor(failure)); }
    return null;
  }
  function startNew() {
    stash();
    const operation = ticket();
    activate(current.current.context, undefined, [], current.current.focusedTitle);
    update({ ...current.current, requestId: undefined });
    void save(current.current).catch(() => { if (operation.valid()) setError("Could not save this question draft. Try again."); });
  }
  return { ...session, history, showHistory, busy, error, send, openHistory, load, review, startNew, selectScope,
    retryFocus: () => setAttempt((value) => value + 1),
    setQuestion: (question: string) => { if (!working.current && !current.current.resolving) update({ ...current.current, question, requestId: undefined }); } };
}

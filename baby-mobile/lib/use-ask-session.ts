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
interface DraftSession { owner?: symbol; version: number; question: string; requestId?: string }
const draftSessions = new WeakMap<object, Map<string, DraftSession>>();
export function useAskSession(recordId?: string, active = true) {
  const [attempt, setAttempt] = useState(0);
  const b = useBaby(),
    key = JSON.stringify([b.owner, b.state.bootstrap?.generation, b.api.lease(),
      b.state.bootstrap?.profile.ai_consent, b.state.selectedChild, recordId ?? null, attempt]);
  const live = useRef({ b, key, active });
  live.current = { b, key, active };
  const mounted = useRef(true), sequence = useRef(0), initialized = useRef(false), working = useRef(false), historyRequest = useRef(0),
    token = useRef(Symbol("Ask screen")),
    owned = useRef<{ entry: DraftSession; key: string; version: number } | undefined>(undefined);
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
  function update(next: Session) {
    const lease = owned.current;
    if (lease && lease.entry.owner === token.current && lease.key === memoryKey(activeAccount.current, next)) {
      lease.entry.question = next.question; lease.entry.requestId = next.requestId;
    }
    current.current = next; setSession(next);
  }
  const memoryKey = (account: Account, snapshot: Session) =>
    JSON.stringify([account.owner, account.state.bootstrap?.generation, askDraftKey(snapshot.context, snapshot.conversation)]);
  function sessions(account: Account) {
    let entries = draftSessions.get(account.api);
    if (!entries) { entries = new Map(); draftSessions.set(account.api, entries); }
    return entries;
  }
  function release() {
    const lease = owned.current;
    if (lease?.entry.owner === token.current && lease.version === lease.entry.version) lease.entry.owner = undefined;
    owned.current = undefined;
  }
  function claim(snapshot: Session) {
    const account = live.current.b, key = memoryKey(account, snapshot), entries = sessions(account);
    const entry = entries.get(key) ?? { version: 0, question: snapshot.question, requestId: snapshot.requestId };
    if (owned.current?.entry !== entry || entry.owner !== token.current) {
      release(); entry.owner = token.current; entry.version++; entries.set(key, entry);
    }
    owned.current = { entry, key, version: entry.version };
  }
  function draft(snapshot: Session): EditorDraft | null {
    return snapshot.question.trim() ? {
      id: Crypto.randomUUID(), kind: "journal", title: "Unsent question", body: snapshot.question,
      child_id: snapshot.context.child_id, occurred_at: new Date().toISOString(),
      data: { ...snapshot.context, request_id: snapshot.requestId }, files: [],
    } : null;
  }
  function save(snapshot: Session, account = activeAccount.current) {
    const lease = owned.current;
    if (!lease || lease.entry.owner !== token.current || lease.key !== memoryKey(account, snapshot)) return Promise.resolve();
    // A blur flush may finish after release, but never after a newer owner or
    // question took over. The provider checks this again inside its write queue.
    const valid = () => lease.entry.version === lease.version &&
      (lease.entry.owner === token.current || lease.entry.owner === undefined) &&
      lease.entry.question === snapshot.question && lease.entry.requestId === snapshot.requestId &&
      account.current() && account.owner === live.current.b.owner && account.api === live.current.b.api &&
      account.state.bootstrap?.generation === live.current.b.state.bootstrap?.generation;
    return valid() ? account.saveDraft(askDraftKey(snapshot.context, snapshot.conversation), draft(snapshot), valid) : Promise.resolve();
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
      cached = sessions(account).get(memoryKey(account, snapshot)),
      saved = account.state.drafts[askDraftKey(context, conversation)];
    if (cached) return { question: cached.question, requestId: cached.requestId };
    if (saved) return { question: saved.body, requestId: typeof saved.data.request_id === "string" ? saved.data.request_id : undefined };
    // Read old app drafts without reusing an idempotency key with corrected context.
    const legacy = account.state.drafts["chat:" + String(context.record_id ?? conversation ?? context.scope)];
    return legacy && (context.record_id || legacy.child_id === context.child_id)
      ? { question: legacy.body } : { question: "" };
  }
  function ticket(advance = true) {
    const account = live.current.b, capturedKey = live.current.key, lease = account.api.lease(),
      nonce = advance ? ++sequence.current : sequence.current, draftLease = owned.current;
    return {
      account,
      valid: () => mounted.current && live.current.active && nonce === sequence.current && capturedKey === live.current.key &&
        (!draftLease || (draftLease.entry.owner === token.current && draftLease.entry.version === draftLease.version)) &&
        account.current() && live.current.b.api === account.api && live.current.b.owner === account.owner &&
        account.api.lease() === lease,
    };
  }
  function activate(context: AskContext, conversation?: string, messages: ChatMessage[] = [], title?: string) {
    activeAccount.current = live.current.b;
    const next = { context, conversation, messages, ...restored(context, conversation), focusedTitle: title, resolving: false };
    claim(next); update(next);
    working.current = false; setBusy(false); setError("");
  }
  useEffect(() => {
    if (!active) {
      stash(); release(); sequence.current++; working.current = false; setBusy(false);
      if (activeKey.current !== key) initialized.current = false;
      activeKey.current = key;
      return;
    }
    if (initialized.current && activeKey.current === key && !current.current.resolving) {
      const prior = current.current;
      activate(prior.context, prior.conversation, prior.messages, prior.focusedTitle);
      return;
    }
    if (initialized.current) stash();
    release();
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
  }, [key, active]);
  useEffect(() => {
    if (!active || session.resolving) return;
    const snapshot = session, account = activeAccount.current;
    const timer = setTimeout(() => {
      void save(snapshot, account).catch(() => {
        if (sameAccount(account)) setError("Your question has not been saved on this device. Keep this screen open and try again.");
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [active, session.question, session.requestId, session.context, session.conversation, session.resolving]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", (state) => { if (state !== "active") stash(); });
    return () => { stash(); release(); mounted.current = false; sequence.current++; listener.remove(); };
  }, []);
  function selectScope(scope: Scope) {
    if (!live.current.active) return;
    stash(); sequence.current++;
    activate({ scope, record_id: null, child_id: live.current.b.state.selectedChild });
  }
  async function send() {
    const snapshot = current.current, account = live.current.b;
    if (!live.current.active || !owned.current || owned.current.entry.owner !== token.current || working.current || snapshot.resolving || !snapshot.question.trim() || activeKey.current !== live.current.key) return;
    if (!account.state.bootstrap?.profile.ai_consent) { setError("Enable optional AI processing in Settings first."); return; }
    const operation = ticket(), requestId = snapshot.requestId ?? Crypto.randomUUID(), text = snapshot.question.trim(),
      sent = { ...snapshot, question: text, requestId };
    setShowHistory(false);
    update(sent); working.current = true; setBusy(true); setError("");
    try {
      await save(sent, account);
      if (!operation.valid()) return;
      const result = await account.api.chat({ ...snapshot.context,
        record_id: snapshot.context.record_id ?? undefined, conversation_id: snapshot.conversation,
        request_id: requestId, message: text }, account.state.bootstrap!.generation);
      if (!operation.valid()) return;
      await account.saveDraft(askDraftKey(snapshot.context, snapshot.conversation), null, operation.valid);
      if (!operation.valid()) return;
      const entry = owned.current!.entry; entry.question = ""; entry.requestId = undefined;
      activate(snapshot.context, result.conversation_id, [...snapshot.messages, { role: "user", content: text },
        { role: "assistant", content: result.message, citations: result.citations, proposal: result.proposal }], snapshot.focusedTitle);
    } catch (failure) { if (operation.valid()) setError(messageFor(failure)); }
    finally { if (operation.valid()) { working.current = false; setBusy(false); } }
  }
  async function openHistory() {
    if (!live.current.active) return;
    const number = ++historyRequest.current;
    if (showHistory) { setShowHistory(false); return; }
    const operation = ticket(false);
    setShowHistory(true); setError("");
    try { const result = await operation.account.api.conversations(); if (operation.valid() && number === historyRequest.current) setHistory(result.items); }
    catch (failure) { if (operation.valid() && number === historyRequest.current) setError(messageFor(failure)); }
  }
  async function load(id: string) {
    if (!live.current.active) return;
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
    if (!live.current.active) return null;
    const operation = ticket(false), id = Crypto.randomUUID(), key = "proposal:" + id;
    const value: EditorDraft = { id, kind: proposal.kind, title: proposal.title, body: proposal.body,
      child_id: current.current.context.child_id, occurred_at: new Date().toISOString(),
      data: { ...proposal.data, ...(proposal.kind === "routine" ? { enabled: false } : {}) }, files: [] };
    try { await operation.account.saveDraft(key, value, operation.valid); if (operation.valid()) return { key, kind: proposal.kind }; }
    catch (failure) { if (operation.valid()) setError(messageFor(failure)); }
    return null;
  }
  function startNew() {
    if (!live.current.active) return;
    stash();
    const operation = ticket();
    activate(current.current.context, undefined, [], current.current.focusedTitle);
    update({ ...current.current, requestId: undefined });
    void save(current.current).catch(() => { if (operation.valid()) setError("Could not save this question draft. Try again."); });
  }
  return { ...session, history, showHistory, busy, error, send, openHistory, load, review, startNew, selectScope,
    retryFocus: () => setAttempt((value) => value + 1),
    setQuestion: (question: string) => { if (live.current.active && owned.current?.entry.owner === token.current && !working.current && !current.current.resolving) update({ ...current.current, question, requestId: undefined }); } };
}

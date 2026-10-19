import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { readableCitations } from "@/lib/chat-citations";
import {
  messageFor,
  type ChatMessage,
  type Conversation,
  type EditorDraft,
  type Proposal,
  type Scope,
} from "@/lib/models";
import {
  Button,
  Card,
  Chips,
  Copy,
  Empty,
  Field,
  Loading,
  Notice,
  Row,
  Screen,
  Section,
  useColors,
} from "@/components/ui";
export default function Ask() {
  const b = useBaby(),
    params = useLocalSearchParams<{ record_id?: string }>(),
    c = useColors(),
    [scope, setScope] = useState<Scope>("all"),
    [question, setQuestion] = useState(""),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [conversation, setConversation] = useState<string>(),
    [history, setHistory] = useState<Conversation[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    request = useRef<string | undefined>(undefined),
    sequence = useRef(0),
    consent = useRef(b.state.bootstrap!.profile.ai_consent);
  consent.current = b.state.bootstrap!.profile.ai_consent;
  const focused = b.records.find((r) => r.id === params.record_id),
    slot = "chat:" + String(params.record_id ?? conversation ?? scope);
  useEffect(() => {
    const draft = b.state.drafts[slot];
    setQuestion(draft?.body ?? "");
    request.current = typeof draft?.data.request_id === "string" ? draft.data.request_id : undefined;
  }, [slot]);
  useEffect(() => {
    if (!b.state.bootstrap!.profile.ai_consent) {
      sequence.current++;
      setMessages([]);
      setHistory([]);
    }
  }, [b.state.bootstrap!.profile.ai_consent]);
  useEffect(() => {
    if (!question.trim()) return;
    const timer = setTimeout(() => {
      const d: EditorDraft = {
        id: Crypto.randomUUID(),
        kind: "journal",
        title: "Unsent question",
        body: question,
        child_id: b.state.selectedChild,
        occurred_at: new Date().toISOString(),
        data: { request_id: request.current, scope },
        files: [],
      };
      void b
        .saveDraft(slot, d)
        .catch(() => setError("Your question has not been saved on this device. Keep this screen open and try again."));
    }, 400);
    return () => clearTimeout(timer);
  }, [question, slot]);
  async function send() {
    if (busy || !question.trim()) return;
    if (!consent.current) {
      setError("Enable optional AI processing in Settings first.");
      return;
    }
    setBusy(true);
    setError("");
    const text = question.trim(),
      nonce = ++sequence.current,
      id = request.current ?? Crypto.randomUUID();
    request.current = id;
    try {
      await b.saveDraft(slot, {
        id: Crypto.randomUUID(),
        kind: "journal",
        title: "Unsent question",
        body: text,
        child_id: b.state.selectedChild,
        occurred_at: new Date().toISOString(),
        data: { request_id: id, scope },
        files: [],
      });
      const result = await b.api.chat(
        {
          request_id: id,
          conversation_id: conversation,
          message: text,
          scope,
          record_id: params.record_id,
          child_id: b.state.selectedChild,
        },
        b.state.bootstrap!.generation
      );
      if (!b.current() || nonce !== sequence.current || !consent.current) return;
      setMessages((prior) => [
        ...prior,
        { role: "user", content: text },
        { role: "assistant", content: result.message, citations: result.citations, proposal: result.proposal },
      ]);
      setConversation(result.conversation_id);
      await b.saveDraft(slot, null);
      setQuestion("");
      request.current = undefined;
    } catch (e) {
      if (nonce === sequence.current) setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  async function openHistory() {
    setShowHistory(!showHistory);
    if (showHistory) return;
    try {
      const list = await b.api.conversations();
      setHistory(list.items);
    } catch (e) {
      setError(messageFor(e));
    }
  }
  async function load(id: string) {
    setBusy(true);
    try {
      const result = await b.api.conversation(id);
      setConversation(id);
      setMessages(result.messages ?? []);
      setShowHistory(false);
      setQuestion("");
      request.current = undefined;
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  async function review(proposal: Proposal) {
    const id = Crypto.randomUUID(),
      key = "proposal:" + id,
      draft: EditorDraft = {
        id,
        kind: proposal.kind,
        title: proposal.title,
        body: proposal.body,
        child_id: b.state.selectedChild,
        occurred_at: new Date().toISOString(),
        data: { ...proposal.data, ...(proposal.kind === "routine" ? { enabled: false } : {}) },
        files: [],
      };
    try {
      await b.saveDraft(key, draft);
      router.push({ pathname: "/edit", params: { draft: key, kind: proposal.kind } });
    } catch (e) {
      setError(messageFor(e));
    }
  }
  const available = b.state.bootstrap!.ai_available && b.state.bootstrap!.profile.ai_consent;
  return (
    <Screen
      title={focused ? "Ask about this" : "A little help thinking it through."}
      subtitle={focused ? focused.title : "Find what you saved. Make sense of your own notes."}
      action={<Button secondary title="History" icon="time-outline" onPress={() => void openHistory()} />}
    >
      {!available && (
        <Card tone="soft">
          <Copy kind="heading">AI is optional.</Copy>
          <Copy tone="muted">
            Questions may use your selected saved sources and personal records. Permission can be changed at any time.
            Your Recipes and Workouts information is not included.
          </Copy>
          <Button secondary title="Review AI permission" onPress={() => router.push("/settings")} />
          {!b.state.bootstrap!.ai_available && (
            <Notice>AI is not available on this service yet. Your library, journal, and care logs still work.</Notice>
          )}
        </Card>
      )}
      {!focused && (
        <Chips
          value={scope}
          options={[
            { label: "Everything", value: "all" },
            { label: "Library", value: "library" },
            { label: "Journal", value: "journal" },
            { label: "Care", value: "care" },
          ]}
          onChange={(v) => {
            sequence.current++;
            setScope(v as Scope);
            setConversation(undefined);
            setMessages([]);
          }}
        />
      )}
      {params.record_id && !focused && (
        <Notice>
          Questions are focused on the selected saved record. Open its entry to review the original source.
        </Notice>
      )}
      {showHistory && (
        <Section title="Your conversations">
          {history.length ? (
            history.map((h) => (
              <Row
                key={h.id}
                title={h.title || "A previous conversation"}
                detail={h.updated_at ? new Date(h.updated_at).toLocaleDateString() : undefined}
                icon="chatbubbles-outline"
                onPress={() => void load(h.id)}
              />
            ))
          ) : (
            <Copy tone="muted">Your conversations will appear here.</Copy>
          )}
        </Section>
      )}
      {!messages.length && available && (
        <Empty
          icon="sparkles-outline"
          title="Start with something on your mind."
          body={
            focused
              ? "Ask for a summary, find a detail, or draft a checklist from this source. You will review any proposed changes."
              : "“Which of my saved videos mentions hospital bags?” or “Help me prepare questions from my recent notes.”"
          }
        />
      )}
      {messages.map((m, index) => (
        <Card key={m.id ?? index} tone={m.role === "user" ? "soft" : "normal"}>
          <Copy kind="eyebrow" tone="muted">
            {m.role === "user" ? "YOU" : "HÅFA BABY"}
          </Copy>
          <Copy>{m.role === "assistant" ? readableCitations(m.content, m.citations) : m.content}</Copy>
          {!!m.citations?.length && (
            <Section title="Sources used">
              {m.citations.map((citation, sourceIndex) => (
                <Row
                  key={citation.id}
                  title={`${sourceIndex + 1}. ${citation.title}`}
                  detail={citation.excerpt}
                  icon="bookmark-outline"
                  onPress={() => router.push({ pathname: "/record/[id]", params: { id: citation.id } })}
                />
              ))}
            </Section>
          )}
          {m.proposal && (
            <Card tone="soft">
              <Copy kind="heading">Proposed: {m.proposal.title}</Copy>
              <Copy tone="muted">Nothing has been added or activated. Review and edit this suggestion first.</Copy>
              <Button title="Review suggestion" onPress={() => void review(m.proposal!)} />
            </Card>
          )}
        </Card>
      ))}
      {!!error && <Notice error>{error}</Notice>}
      {busy && <Loading label="Looking through the selected context…" />}
      <Field
        label={focused ? "Ask about this source or entry" : "Your question"}
        multiline
        value={question}
        onChange={(text) => {
          request.current = undefined;
          setQuestion(text);
        }}
        placeholder="What would you like to find or understand?"
        disabled={busy}
      />
      <Button
        title={error && request.current ? "Retry this question" : "Ask"}
        icon="arrow-up"
        busy={busy}
        disabled={!available || !question.trim()}
        onPress={() => void send()}
      />
      <Copy kind="small" tone="muted">
        Saved advice, your observations, and clinician-entered instructions are different sources. Check original
        context and bring health decisions to your clinician.
      </Copy>
      {messages.length > 0 && (
        <Button
          variant="ghost"
          title="Start a new conversation"
          onPress={() => {
            sequence.current++;
            setMessages([]);
            setConversation(undefined);
            setQuestion("");
            request.current = undefined;
            void b.saveDraft(slot, null);
          }}
        />
      )}
      <View style={{ height: 65 }} />
    </Screen>
  );
}

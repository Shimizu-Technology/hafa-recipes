import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { readableCitations } from "@/lib/chat-citations";
import { useAskSession } from "@/lib/use-ask-session";
import type { Proposal, Scope } from "@/lib/models";
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
} from "@/components/ui";
export default function Ask() {
  const b = useBaby(),
    params = useLocalSearchParams<{ record_id?: string }>(),
    chat = useAskSession(params.record_id),
    { question, messages, history, showHistory, busy, error, send, openHistory, load } = chat;
  const focused = !!chat.context.record_id;
  async function review(proposal: Proposal) {
    const result = await chat.review(proposal);
    if (result) router.push({ pathname: "/edit", params: { draft: result.key, kind: result.kind } });
  }
  const available = b.state.bootstrap!.ai_available && b.state.bootstrap!.profile.ai_consent;
  return (
    <Screen
      title={focused ? "Ask about this" : "A little help thinking it through."}
      subtitle={focused ? chat.focusedTitle ?? "Your selected saved entry" : "Find what you saved. Make sense of your own notes."}
      action={<Button secondary title="History" icon="time-outline" disabled={chat.resolving} onPress={() => void openHistory()} />}
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
          value={chat.context.scope}
          options={[
            { label: "Everything", value: "all" },
            { label: "Library", value: "library" },
            { label: "Journal", value: "journal" },
            { label: "Care", value: "care" },
          ]}
          onChange={(v) => chat.selectScope(v as Scope)}
        />
      )}
      {focused && (
        <>
          <Notice>Questions use this saved entry and its own child profile, including general entries.</Notice>
          <Button secondary title="Ask without a specific entry" onPress={() => chat.selectScope("all")} />
        </>
      )}
      <Copy kind="small" tone="muted">
        {chat.context.child_id
          ? "For " + (b.state.bootstrap!.children.find((child) => child.id === chat.context.child_id)?.name ?? "the conversation’s child profile")
          : focused ? "General / personal entry" : "All your entries"}
      </Copy>
      {chat.resolving && !busy && (
        <Button secondary title="Try opening this entry again" onPress={chat.retryFocus} />
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
        onChange={chat.setQuestion}
        placeholder="What would you like to find or understand?"
        disabled={busy || chat.resolving}
      />
      <Button
        title={error && chat.requestId ? "Retry this question" : "Ask"}
        icon="arrow-up"
        busy={busy}
        disabled={!available || chat.resolving || !question.trim()}
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
          onPress={chat.startNew}
        />
      )}
      <View style={{ height: 65 }} />
    </Screen>
  );
}

import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { citationExcerpt, readableCitations } from "@/lib/chat-citations";
import { kindIcon } from "@/components/record-row";
import { useAskSession } from "@/lib/use-ask-session";
import type { Proposal, Scope } from "@/lib/models";
import { Button, Card, Chips, Copy, Empty, Icon, Loading, Notice, Row, Screen, Section, fonts, useColors } from "@/components/ui";
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
  const available = b.state.bootstrap!.ai_available && b.state.bootstrap!.profile.ai_consent,
    canSend = available && !busy && !chat.resolving && !!question.trim(),
    c = useColors();
  return (
    <Screen
      title={focused ? "Ask about this" : "Ask"}
      subtitle={focused ? chat.focusedTitle ?? "Your selected saved entry" : "Find what you saved and make sense of your notes."}
      action={<Button secondary title="History" icon="time-outline" disabled={chat.resolving} onPress={() => void openHistory()} />}
      followEnd
      footer={
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          <TextInput
            accessibilityLabel={focused ? "Ask about this source or entry" : "Your question"}
            value={question}
            onChangeText={chat.setQuestion}
            placeholder={available ? "Ask about your saved entries…" : "Turn on AI in Settings to ask"}
            placeholderTextColor={c.muted}
            editable={!busy && !chat.resolving}
            multiline
            maxLength={4000}
            maxFontSizeMultiplier={1.6}
            style={{ flex: 1, maxHeight: 132, minHeight: 46, borderWidth: 1, borderColor: c.border, borderRadius: 22,
              backgroundColor: c.surface, color: c.text, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
              fontFamily: fonts.regular, fontSize: 17, lineHeight: 22 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={error && chat.requestId ? "Retry this question" : "Send question"}
            accessibilityState={{ disabled: !canSend, busy }}
            disabled={!canSend}
            onPress={() => void send()}
            style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center",
              backgroundColor: c.action, opacity: !canSend ? 0.4 : pressed ? 0.8 : 1,
              transform: [{ scale: pressed && canSend ? 0.95 : 1 }] })}
          >
            {busy ? <ActivityIndicator color={c.onAction} /> : <Icon name={error && chat.requestId ? "refresh" : "arrow-up"} color={c.onAction} size={24} />}
          </Pressable>
        </View>
      }
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
      {messages.map((m, index) =>
        m.role === "user" ? (
          <View
            key={m.id ?? index}
            accessible
            accessibilityLabel={`You asked: ${m.content}`}
            style={{ alignSelf: "flex-end", maxWidth: "86%", backgroundColor: c.soft, borderRadius: 20,
              borderBottomRightRadius: 6, paddingVertical: 12, paddingHorizontal: 16 }}
          >
            <Copy>{m.content}</Copy>
          </View>
        ) : (
          <View key={m.id ?? index} style={{ gap: 12 }}>
            <Copy>{readableCitations(m.content, m.citations)}</Copy>
            {!!m.citations?.length && (
              <View style={{ gap: 8 }}>
                <Copy kind="small" tone="muted">
                  From your saved entries
                </Copy>
                {m.citations.map((citation, sourceIndex) => (
                  <Row
                    key={citation.id}
                    title={`${sourceIndex + 1}. ${citation.title}`}
                    detail={citationExcerpt(citation) || undefined}
                    icon={(citation.kind && kindIcon[citation.kind]) || "bookmark-outline"}
                    hint="Opens this entry"
                    onPress={() => router.push({ pathname: "/record/[id]", params: { id: citation.id } })}
                  />
                ))}
              </View>
            )}
            {m.proposal && (
              <Card tone="soft">
                <Copy kind="heading">Proposed: {m.proposal.title}</Copy>
                <Copy tone="muted">Nothing has been added or activated. Review and edit this suggestion first.</Copy>
                <Button title="Review suggestion" onPress={() => void review(m.proposal!)} />
              </Card>
            )}
          </View>
        )
      )}
      {!!error && <Notice error>{error}</Notice>}
      {busy && <Loading label="Looking through your saved entries…" />}
      {messages.length > 0 && (
        <>
          <Copy kind="small" tone="muted">
            Saved advice, your own observations and clinician instructions are different sources. Check the original and
            bring health decisions to your clinician.
          </Copy>
          <Button variant="ghost" title="Start a new conversation" onPress={chat.startNew} />
        </>
      )}
    </Screen>
  );
}

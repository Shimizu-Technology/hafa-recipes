import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { friendlyDate } from "@/lib/care-format";
import { useBaby } from "@/lib/context";
import { ASK_UPDATE_TITLE, acknowledgeAsk, needsAskAcknowledgment } from "@/lib/ai-consent";
import { CANT_ANSWER_LINE, answeredCalmly, unavailablePlaceholder } from "../lib/ask-sources";
import { citationExcerpt, readableCitations } from "@/lib/chat-citations";
import { AnswerText, WebSources } from "./ask-answer";
import { AskHistory } from "./ask-history";
import { kindIcon } from "@/components/record-row";
import { useAskSession } from "@/lib/use-ask-session";
import { kindName, type Proposal } from "@/lib/models";
import { babyLabel, isCaregiver } from "../lib/spaces";
import { Button, Card, Copy, Grouped, Icon, Loading, Notice, PressTarget, Row, Screen, Section, fonts, radii, useColors } from "@/components/ui";
import { HeaderIconButton, HeaderPill, TabActions, headerActions } from "./tab-stack";
/** Where an older conversation from History searches; new chats always search everything. */
const scopeLine = { all: "All your entries", library: "Saved posts only", journal: "Journal only", care: "Care logs only" } as const;
/** Questions she might ask before the birth, matched to what Kami saves (hospital bag, labour prep, the weeks ahead). */
const suggestions = [
  "Which of my saved videos mention the hospital bag?",
  "What did I save for the weeks ahead?",
  "Help me prepare questions from my recent notes.",
];

/**
 * Why Ask can't answer most questions yet, as one compact line above the question box. The box itself always works:
 * the server answers anything urgent with the AI off, and a person shouldn't have to find that out in Settings.
 */
export function AiNotice({ service, consent }: { service: boolean; consent: boolean }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <View accessibilityRole="summary" style={{ flexDirection: fontScale >= 1.5 ? "column" : "row", alignItems: fontScale >= 1.5 ? "flex-start" : "center",
    gap: 10, paddingVertical: 10, paddingLeft: 14, paddingRight: consent ? 14 : 6, borderRadius: radii.notice, backgroundColor: c.tile }}>
    <Icon name={service ? "lock-closed-outline" : "cloud-offline-outline"} size={18} color={c.accentText} />
    <View style={{ flex: fontScale >= 1.5 ? undefined : 1 }}>
      <Copy kind="small" tone="muted">{service
        ? "AI is off. Ask uses your Baby entries only, never Recipes or Workouts."
        : "AI isn’t available on this service yet. Saved, Journal and care logs still work."}</Copy>
    </View>
    {!consent && <PressTarget accessibilityRole="button" accessibilityLabel="Review AI permission" onPress={() => router.push({ pathname: "/settings", params: { section: "ai" } })}
      style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
      <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: c.accentText }}>Review</Text>
    </PressTarget>}
  </View>;
}
/** Ask keeps working as it did. This only offers the new one, and nothing changes until it is accepted. */
/** Whenever Ask can't answer: so a wording the urgent check misses, or no connection at all, still gets her to Help. */
export function CantAnswer({ error }: { error: string }) {
  return <>
    <Notice error>{error}</Notice>
    <Copy kind="small">{CANT_ANSWER_LINE}</Copy>
    <Button secondary title="Open Help" onPress={() => router.push("/help")} />
  </>;
}

export function AskUpdateNotice({ onReview }: { onReview: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <View accessibilityRole="summary" style={{ flexDirection: fontScale >= 1.5 ? "column" : "row", alignItems: fontScale >= 1.5 ? "flex-start" : "center",
    gap: 10, paddingVertical: 10, paddingLeft: 14, paddingRight: 6, borderRadius: radii.notice, backgroundColor: c.tile }}>
    <Icon name="sparkles-outline" size={18} color={c.accentText} />
    <View style={{ flex: fontScale >= 1.5 ? undefined : 1 }}>
      <Copy kind="small" tone="muted">{ASK_UPDATE_TITLE}: it can look through everything you can see, and search trusted sites online.</Copy>
    </View>
    <PressTarget accessibilityRole="button" accessibilityLabel="Review what Ask can do" onPress={onReview}
      style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
      <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: c.accentText }}>Review</Text>
    </PressTarget>
  </View>;
}
/** Ask isn't part of helping as a caregiver, whichever link lands here. Her own chats stay stored, for when she leaves. */
export default function AskScreen({ back = false }: { back?: boolean }) {
  return isCaregiver(useBaby().state.bootstrap)
    ? <Screen title="Ask" back={back}><Notice>Ask isn’t part of helping as a caregiver. Your own chats are kept, and they’re here again if you leave the family.</Notice></Screen>
    : <AskChat back={back} />;
}
function AskChat({ back }: { back: boolean }) {
  const [screenFocused, setScreenFocused] = useState(false);
  useFocusEffect(useCallback(() => { setScreenFocused(true); return () => setScreenFocused(false); }, []));
  const b = useBaby(),
    params = useLocalSearchParams<{ record_id?: string; date?: string }>(),
    { fontScale, height } = useWindowDimensions(),
    composerMinimum = Math.max(46, Math.ceil(17 * fontScale * 1.45 + 24)),
    chat = useAskSession(params.record_id, screenFocused, params.date),
    { question, messages, history, showHistory, busy, error, send, openHistory, load } = chat;
  const focusedDay = chat.context.focus_date, focused = !!chat.context.record_id || !!focusedDay,
    askedAbout = b.state.bootstrap!.children.find((child) => child.id === chat.context.child_id),
    focusedCategory = b.records.some((row) => row.id === chat.context.record_id && row.kind === "collection");
  async function review(proposal: Proposal) {
    const result = await chat.review(proposal);
    if (result) router.push({ pathname: "/edit", params: { draft: result.key, kind: result.kind } });
  }
  const available = b.state.bootstrap!.ai_available && b.state.bootstrap!.profile.ai_consent,
    canSend = !busy && !chat.resolving && !!question.trim(),
    c = useColors(),
    answered = answeredCalmly(messages),
    seen = !!b.state.askNoticeSeen,
    // New chat and History stay in the header from every state. Neither can interrupt an answer on its way.
    locked = chat.resolving || busy,
    large = fontScale >= 1.5,
    historyTitle = showHistory ? "Done" : "History",
    actions = <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <HeaderIconButton icon="medkit-outline" label="Help" onPress={() => router.push("/help")} />
      {large ? <HeaderIconButton icon="add" label="New chat" disabled={locked} onPress={chat.startNew} />
        : <HeaderPill title="New chat" disabled={locked} onPress={chat.startNew} />}
      {large ? <HeaderIconButton icon={showHistory ? "close" : "time-outline"} label={historyTitle} disabled={chat.resolving} onPress={() => void openHistory()} />
        : <HeaderPill title={historyTitle} disabled={chat.resolving} onPress={() => void openHistory()} />}
    </View>;
  // The reminder about sources appears under her first answer, and stays out of every chat after that.
  const [showNotice, setShowNotice] = useState(false);
  useEffect(() => {
    if (!answered) return setShowNotice(false);
    if (seen) return;
    setShowNotice(true);
    void b.commit((state) => ({ ...state, askNoticeSeen: true })).catch(() => undefined);
  }, [answered, seen]);
  return (
    <Screen
      key={showHistory ? "history" : "conversation"}
      onRefresh={() => b.sync()}
      back={back}
      title={focused ? "Ask about this" : "Ask"}
      subtitle={focusedDay ? friendlyDate(focusedDay) : focused ? chat.focusedTitle ?? "Your selected saved entry" : "Find what you saved and make sense of your notes."}
      followEnd={!showHistory && (messages.length > 0 || (busy && !chat.resolving))}
      footer={<View style={{ gap: 10 }}>
        {!available && <AiNotice service={b.state.bootstrap!.ai_available} consent={b.state.bootstrap!.profile.ai_consent} />}
        {available && needsAskAcknowledgment(b.state.bootstrap) && <AskUpdateNotice onReview={() => void acknowledgeAsk(b).catch(() => undefined)} />}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          <TextInput
            key={fontScale}
            accessibilityLabel={focusedDay ? "Ask about this day" : focusedCategory ? "Ask about this category" : focused ? "Ask about this source or entry" : "Your question"}
            value={question}
            onChangeText={chat.setQuestion}
            placeholder={available ? fontScale >= 1.5 ? "Question" : "Ask about your saved entries…"
              : unavailablePlaceholder(fontScale)}
            placeholderTextColor={c.muted}
            editable={!busy && !chat.resolving}
            multiline
            maxLength={4000}
            maxFontSizeMultiplier={0}
            scrollEnabled
            style={{ flex: 1, maxHeight: Math.max(composerMinimum, Math.min(height * 0.3, 132 * Math.max(1, fontScale))),
              minHeight: composerMinimum, borderRadius: 24,
              backgroundColor: c.surface, color: c.text, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
              fontFamily: fonts.regular, fontSize: 17, lineHeight: 22 }}
          />
          <PressTarget
            accessibilityRole="button"
            accessibilityLabel={error && chat.requestId ? "Retry this question" : "Send question"}
            accessibilityState={{ disabled: !canSend, busy }}
            disabled={!canSend}
            onPress={() => void send()}
            style={{ width: 46, height: 46, alignSelf: "flex-end", borderRadius: 23, alignItems: "center", justifyContent: "center",
              backgroundColor: c.action }}
          >
            {busy ? <ActivityIndicator color={c.onAction} /> : <Icon name={error && chat.requestId ? "refresh" : "arrow-up"} color={c.onAction} size={24} />}
          </PressTarget>
        </View>
      </View>}
    >
      <Stack.Screen options={headerActions(back ? actions : <TabActions action={actions} />)} />
      {focused && (
        <>
          <Notice>{focusedDay ? "Questions start with this day’s log." : focusedCategory ? "Questions start with the posts in this category." : "Questions use this saved entry and its own child profile, including general entries."}</Notice>
          <Button secondary title={focusedDay ? "Ask about everything" : "Ask without a specific entry"} onPress={() => chat.selectScope("all")} />
        </>
      )}
      <Copy kind="small" tone="muted">
        {[chat.context.child_id ? "For " + (askedAbout ? babyLabel(askedAbout, b.state.bootstrap) : "the conversation’s child profile") : "",
          // A conversation keeps searching where it began, so it says so next to the child.
          focusedDay || focusedCategory ? "" : focused ? (chat.context.child_id ? "" : "General / personal entry") : scopeLine[chat.context.scope]].filter(Boolean).join(" · ")}
      </Copy>
      {chat.resolving && !busy && (
        <Button secondary title="Try opening this entry again" onPress={chat.retryFocus} />
      )}
      {showHistory && <AskHistory items={history} manageable={!!b.state.bootstrap!.ask_consent_version} onOpen={(id) => void load(id)}
        onRename={chat.renameConversation} onDelete={chat.deleteConversation} />}
      {!showHistory && !messages.length && (
        <View style={{ gap: 12 }}>
          <Copy kind="heading">{focusedDay ? "Ask about this day." : focusedCategory ? "Ask about this category." : focused ? "Ask about this entry." : "Start with something on your mind."}</Copy>
          <Copy tone="muted">
            {focusedDay
              ? "Ask for a summary or find a detail. You will review any proposed changes."
              : focused
              ? "Ask for a summary, find a detail, or draft a question for your doctor. You will review any proposed changes."
              : "Ask across your saved posts, journal and care logs. Try one of these:"}
          </Copy>
          {!focused && <Grouped separatorInset={16}>{suggestions.map((text) => (
            <PressTarget key={text} accessibilityRole="button" accessibilityLabel={`Use question: ${text}`}
              accessibilityHint={available ? "Puts it in the question box" : "Puts it in the question box. Sending needs AI permission."}
              onPress={() => chat.setQuestion(text)}
              style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.surface }}>
              <View style={{ flex: 1 }}><Copy>{text}</Copy></View>
              <Icon name="arrow-up-circle-outline" size={20} color={c.accentText} />
            </PressTarget>
          ))}</Grouped>}
        </View>
      )}
      {!showHistory && messages.map((m, index) =>
        m.role === "user" ? (
          <View
            key={m.id ?? index}
            accessible
            accessibilityLabel={`You asked: ${m.content}`}
            style={{ alignSelf: "flex-end", maxWidth: "86%", backgroundColor: c.action, borderRadius: radii.bubble,
              borderBottomRightRadius: 6, paddingVertical: 12, paddingHorizontal: 16 }}
          >
            <Text key={fontScale} maxFontSizeMultiplier={0} style={{ color: c.onAction, fontFamily: fonts.regular, fontSize: 17, lineHeight: 22 }}>
              {m.content}
            </Text>
          </View>
        ) : (
          <View key={m.id ?? index} style={{ gap: 12 }}>
            {!!m.help && <Button title="Open Help" onPress={() => router.push("/help")} />}
            <AnswerText text={readableCitations(m.content, m.citations)} sources={m.sources} />
            {!!m.citations?.length && (
              <View style={{ gap: 8 }}>
                <Copy kind="small" tone="muted">
                  From your entries
                </Copy>
                <Grouped>{m.citations.map((citation, sourceIndex) => (
                  <Row
                    key={citation.id}
                    title={`${sourceIndex + 1}. ${citation.title}`}
                    detail={citationExcerpt(citation) || undefined}
                    icon={(citation.kind && kindIcon[citation.kind]) || "bookmark-outline"}
                    hint="Opens this entry"
                    onPress={() => router.push({ pathname: "/record/[id]", params: { id: citation.id } })}
                  />
                ))}</Grouped>
              </View>
            )}
            <WebSources sources={m.sources} />
            {m.proposal && (
              <Card tone="soft">
                <Copy kind="heading">Proposed: {m.proposal.title}</Copy>
                {/* A build without an editor for this kind can't open it, so it says what to do instead. */}
                {kindName[m.proposal.kind] ? <>
                  <Copy tone="muted">Nothing has been added or activated. Review and edit this suggestion first.</Copy>
                  <Button secondary title="Review suggestion" onPress={() => void review(m.proposal!)} />
                </> : <Copy tone="muted">Nothing has been added. This version of the app can’t open this suggestion, so add it yourself if you’d like it.</Copy>}
              </Card>
            )}
          </View>
        )
      )}
      {!!error && <CantAnswer error={error} />}
      {busy && <Loading label="Looking through your saved entries…" />}
      {!showHistory && showNotice && (
        <Copy kind="small" tone="muted">
          Saved advice, your own observations and clinician instructions are different sources. Check the original and
          bring health decisions to your clinician.
        </Copy>
      )}
    </Screen>
  );
}

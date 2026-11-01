import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import { useBaby } from "@/lib/context";
import { pendingSuggestion } from "@/lib/suggestions";
import { sourceTitle } from "@/lib/source-title";
import { dueLine, pregnancyProgress, timingLabel, tipTopic } from "@/lib/timing";
import { Card, Copy, Grouped, Icon, PressTarget, Section, fonts, typeScale, useColors } from "./ui";
import { SavedPostRow } from "./saved-post-row";

/** "Week 34 · Day 3" in SF Rounded with the due date beneath. */
export function PregnancyHero({ child, now }: { child: Child; now: Date }) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    progress = pregnancyProgress(child.due_date!, now)!, due = dueLine(child.due_date!, now);
  return <Card tone="hero" style={{ gap: 4 }}>
    <View accessible accessibilityLabel={`Week ${progress.week}, day ${progress.day}. ${due}`} style={{ gap: 4 }}>
      <Text key={`label:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontWeight: "600", color: c.accentText }}>Your pregnancy</Text>
      <Text key={`value:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ ...typeScale.number, color: c.text }}>
        Week {progress.week}<Text style={{ fontFamily: fonts.rounded, fontWeight: "400", fontSize: 20, lineHeight: 25, color: c.muted }}> · Day {progress.day}</Text>
      </Text>
      <Copy numeric kind="small" tone="muted">{due}</Copy>
    </View>
  </Card>;
}

function SeeAll({ view, title }: { view: string; title: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="link" accessibilityLabel={`See all, ${title}`} hitSlop={8}
    onPress={() => router.navigate({ pathname: "/library", params: { view, at: String(Date.now()) } })}
    style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.subhead, color: c.accentText }}>See all</Text>
  </PressTarget>;
}

/** Calm rows of saved tips: thumbnail, title, and her topic (or the stated timing for what's next). */
export function TipSection({ title, rows, view, empty, showTiming }: { title: string; rows: BabyRecord[]; view: string; empty?: string; showTiming?: boolean }) {
  const b = useBaby(), collections = b.records.filter((row) => row.kind === "collection");
  if (!rows.length && !empty) return null;
  return <Section title={title} action={rows.length ? <SeeAll view={view} title={title} /> : undefined}>
    {rows.length ? <Grouped separatorInset={80}>
      {rows.map((row) => <SavedPostRow key={row.id} record={row} pending={false}
        meta={[showTiming ? timingLabel(row.data.relevance) : "", tipTopic(row, collections)].filter(Boolean).join(" · ") || undefined} />)}
    </Grouped> : <Copy kind="small" tone="muted">{empty}</Copy>}
  </Section>;
}

/** "Suggested: Labor prep" with a one-tap Add and a quiet way to say no. */
export function SuggestionLine({ record, busy, isNew, onAccept, onDismiss }: {
  record: BabyRecord; busy: boolean; isNew: boolean; onAccept: () => void; onDismiss: () => void;
}) {
  const c = useColors(), { fontScale } = useWindowDimensions(), suggestion = pendingSuggestion(record), title = sourceTitle(record);
  if (!suggestion) return null;
  const name = suggestion.name + (isNew ? " (new)" : "");
  return <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", alignItems: fontScale >= 1.3 ? "flex-start" : "center",
    gap: 8, paddingLeft: fontScale >= 1.3 ? 12 : 80, paddingRight: 12, paddingBottom: 12, marginTop: -4, backgroundColor: c.surface }}>
    <View style={{ flex: fontScale >= 1.3 ? undefined : 1 }}>
      <Copy kind="small" tone="muted" lines={fontScale >= 1.3 ? undefined : 1}>Suggested: {name}</Copy>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <PressTarget accessibilityRole="button" accessibilityLabel={`Add “${title}” to ${suggestion.name}${isNew ? " (new category)" : ""}`} accessibilityState={{ disabled: busy, busy }}
        disabled={busy} onPress={onAccept}
        style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.soft, justifyContent: "center", opacity: busy ? 0.5 : 1 }}
        hitSlop={4}>
        <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.subhead, fontWeight: "600", color: c.action }}>Add</Text>
      </PressTarget>
      <PressTarget accessibilityRole="button" accessibilityLabel={`Not ${suggestion.name} for “${title}”`} accessibilityHint="Keeps this post in Uncategorized without a suggestion"
        disabled={busy} onPress={onDismiss} hitSlop={4}
        style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={18} color={c.muted} />
      </PressTarget>
    </View>
  </View>;
}

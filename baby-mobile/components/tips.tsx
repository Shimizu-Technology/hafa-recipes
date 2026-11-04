import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import { useBaby } from "@/lib/context";
import { pendingSuggestion } from "@/lib/suggestions";
import { sourceTitle } from "@/lib/source-title";
import { dueLine, pregnancyProgress, timingLabel, tipTopic } from "@/lib/timing";
import { Image } from "expo-image";
import { Copy, Grouped, Icon, PressTarget, Section, fonts, radii, typeScale, useColors } from "./ui";
import { Monogram, SavedPostRow, safeThumbnail } from "./saved-post-row";
import { FadeUp } from "./motion";
import { WeekFacts } from "./week-facts";

const weekStyle = { fontFamily: fonts.display, fontSize: 52, lineHeight: 58, fontVariant: ["tabular-nums" as const] };
const dayStyle = { fontFamily: fonts.displayItalic, fontSize: 22, lineHeight: 28 };
const TOTAL_WEEKS = 40;

/** A saved tip as a compact row inside the hero: photo (or monogram on the card colour), title and topic. */
function MiniTip({ row, topic }: { row: BabyRecord; topic: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), title = sourceTitle(row), stacked = fontScale >= 2,
    thumbnail = safeThumbnail(row), [broken, setBroken] = useState(false);
  return <PressTarget accessibilityRole="button" accessibilityLabel={[title, topic].filter(Boolean).join(". ")}
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: row.id } })}
    style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", gap: 12, minHeight: 56, paddingVertical: 6 }}>
    <View style={{ width: 48, height: 48, borderRadius: radii.thumb, overflow: "hidden" }}>
      {/* On the blush hero the monogram sits on the card colour so it never melts into the hero. */}
      <Monogram title={title} size={48} fill={c.surface} />
      {thumbnail && !broken && <Image source={{ uri: thumbnail }} style={{ position: "absolute", width: 48, height: 48 }} contentFit="cover"
        cachePolicy="memory" transition={150} onError={() => setBroken(true)} />}
    </View>
    <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 2 }}>
      <Text key={fontScale} maxFontSizeMultiplier={0} numberOfLines={fontScale >= 1.3 ? undefined : 2}
        style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: c.text }}>{title}</Text>
      {!!topic && <Copy kind="small" tone="muted" lines={fontScale >= 1.3 ? undefined : 1}>{topic}</Copy>}
    </View>
    {!stacked && <Icon name="chevron-forward" size={16} color={c.muted} />}
  </PressTarget>;
}

/**
 * Today's moment before the birth: one blush card with "Week 34 Day 5" in Newsreader, a soft 34-of-40 bar, the due
 * date, and the tips she saved for this week, so "find what's relevant now" is the first thing she sees.
 */
export function PregnancyHero({ child, now, tips = [] }: { child: Child; now: Date; tips?: BabyRecord[] }) {
  const c = useColors(), { fontScale, width } = useWindowDimensions(), collections = useBaby().records.filter((row) => row.kind === "collection"),
    progress = pregnancyProgress(child.due_date!, now)!, due = dueLine(child.due_date!, now),
    fraction = Math.min(1, (progress.week + progress.day / 7) / TOTAL_WEEKS);
  // "Week 34 Day 5" stays on one line when it fits. When the numeral grows too wide, "Day 5" moves to its own
  // line instead of wrapping mid-phrase. Decided per text size and width.
  const layout = `${fontScale}:${width}`;
  const [stackedFor, setStackedFor] = useState<string | null>(null);
  const stacked = stackedFor === layout;
  return <FadeUp>
    <View style={{ backgroundColor: c.hero, borderRadius: radii.hero, padding: 22, gap: 16 }}>
      <View accessible accessibilityLabel={`Week ${progress.week}, day ${progress.day}. ${due}. ${progress.week} of ${TOTAL_WEEKS} weeks.`} style={{ gap: 12 }}>
        {/* The 52pt numeral grows with text size but stops at 1.5× so "Week 34" stays on screen. */}
        {stacked ? <View style={{ gap: 2 }}>
          <Text key={`value:${layout}`} maxFontSizeMultiplier={1.5} style={{ ...weekStyle, color: c.text }}>Week {progress.week}</Text>
          <Text key={`day:${layout}`} maxFontSizeMultiplier={1.5} style={{ ...dayStyle, color: c.muted }}>Day {progress.day}</Text>
        </View> : <Text key={`value:${layout}`} maxFontSizeMultiplier={1.5} style={{ ...weekStyle, color: c.text }}
          onTextLayout={(event) => { if (event.nativeEvent.lines.length > 1) setStackedFor(layout); }}>
          Week {progress.week}<Text style={{ ...dayStyle, color: c.muted }}>{"\u00a0\u00a0Day\u00a0"}{progress.day}</Text>
        </Text>}
        <View style={{ height: 8, borderRadius: 4, backgroundColor: c.progressTrack, overflow: "hidden" }}>
          <View style={{ width: `${fraction * 100}%`, height: 8, borderRadius: 4, backgroundColor: c.progressFill }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 12, rowGap: 2 }}>
          <Text key={`due:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontFamily: fonts.medium, color: c.text, fontVariant: ["tabular-nums"] }}>{due}</Text>
          <Copy numeric kind="small" tone="muted">{`${progress.week} of ${TOTAL_WEEKS} weeks`}</Copy>
        </View>
      </View>
      <WeekFacts week={progress.week} />
      <View style={{ height: 1, backgroundColor: c.border }} />
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}><Copy kind="heading" numeric>{`Saved for week ${progress.week}`}</Copy></View>
          {tips.length > 0 && <SeeAll view="now" title={`Saved for week ${progress.week}`} />}
        </View>
        {tips.length ? tips.slice(0, 3).map((row) => <MiniTip key={row.id} row={row} topic={tipTopic(row, collections)} />)
          : <Copy kind="small" tone="muted">Tips you save for this point in your pregnancy show up here.</Copy>}
      </View>
    </View>
  </FadeUp>;
}

function SeeAll({ view, title }: { view: string; title: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="link" accessibilityLabel={`See all, ${title}`} hitSlop={8}
    onPress={() => router.navigate({ pathname: "/library", params: { view, at: String(Date.now()) } })}
    style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.subhead, fontFamily: fonts.semibold, color: c.accentText }}>See all</Text>
  </PressTarget>;
}

/** Calm rows of saved tips: thumbnail, title, and her topic (or the stated timing for what's next). */
export function TipSection({ title, rows, view, empty, showTiming }: { title: string; rows: BabyRecord[]; view: string; empty?: string; showTiming?: boolean }) {
  const b = useBaby(), collections = b.records.filter((row) => row.kind === "collection");
  if (!rows.length && !empty) return null;
  return <Section title={title} action={rows.length ? <SeeAll view={view} title={title} /> : undefined}>
    {rows.length ? <Grouped separatorInset={84}>
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
    gap: 8, paddingLeft: fontScale >= 1.3 ? 16 : 84, paddingRight: 16, paddingBottom: 12, marginTop: -4, backgroundColor: c.surface }}>
    <View style={{ flex: fontScale >= 1.3 ? undefined : 1 }}>
      <Copy kind="small" tone="muted" lines={fontScale >= 1.3 ? undefined : 2}>Suggested: {name}</Copy>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <PressTarget accessibilityRole="button" accessibilityLabel={`Add “${title}” to ${suggestion.name}${isNew ? " (new category)" : ""}`} accessibilityState={{ disabled: busy, busy }}
        disabled={busy} onPress={onAccept}
        style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.soft, justifyContent: "center", opacity: busy ? 0.5 : 1 }}
        hitSlop={4}>
        <Text key={fontScale} maxFontSizeMultiplier={0} style={{ ...typeScale.subhead, fontFamily: fonts.semibold, color: c.action }}>Add</Text>
      </PressTarget>
      <PressTarget accessibilityRole="button" accessibilityLabel={`Not ${suggestion.name} for “${title}”`} accessibilityHint="Keeps this post in Uncategorized without a suggestion"
        disabled={busy} onPress={onDismiss} hitSlop={4}
        style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={18} color={c.muted} />
      </PressTarget>
    </View>
  </View>;
}

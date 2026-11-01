import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Child } from "@/lib/models";
import { useBaby } from "@/lib/context";
import { dueLine, pregnancyProgress, timingLabel, tipTopic } from "@/lib/timing";
import { Card, Copy, Grouped, PressTarget, Section, fonts, typeScale, useColors } from "./ui";
import { SavedPostRow } from "./saved-post-row";

/** "Week 34 · Day 3" in SF Rounded with the due date beneath. */
export function PregnancyHero({ child, now }: { child: Child; now: Date }) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    progress = pregnancyProgress(child.due_date!, now)!, due = dueLine(child.due_date!, now);
  return <Card tone="hero" style={{ gap: 4 }}>
    <View accessible accessibilityLabel={`Week ${progress.week}, day ${progress.day}. ${due}`} style={{ gap: 4 }}>
      <Text key={`label:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontWeight: "600", color: c.accentText }}>Your pregnancy</Text>
      <Text key={`value:${fontScale}`} maxFontSizeMultiplier={1.4} style={{ ...typeScale.number, color: c.text }}>
        Week {progress.week}<Text style={{ fontFamily: fonts.rounded, fontWeight: "400", fontSize: 20, lineHeight: 25, color: c.muted }}> · Day{"\u00a0"}{progress.day}</Text>
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

import { Fragment, useState, type ReactNode } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { BabyRecord } from "@/lib/models";
import { sourceTitle } from "@/lib/source-title";
import { timingLabel } from "@/lib/timing";
import type { SavedSection } from "../lib/saved-sections";
import { Grouped, PressTarget, fonts, radii, typeScale, useColors } from "./ui";
import { Cover, SavedPostRow, safeThumbnail } from "./saved-post-row";

const SHELF_CARD = 164;

/** A section's name in Newsreader with its count, and See all. The whole heading does what its chip does. */
export function SectionHeading({ title, count, action = "See all", onPress }: { title: string; count: number; action?: string; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), wraps = fontScale >= 1.5;
  return <PressTarget accessibilityRole="button" accessibilityLabel={`${title}, ${count} ${count === 1 ? "post" : "posts"}. ${action}`} onPress={onPress}
    style={{ minHeight: 44, flexDirection: wraps ? "column" : "row", alignItems: wraps ? "flex-start" : "center", gap: wraps ? 2 : 12 }}>
    <Text key={fontScale} maxFontSizeMultiplier={2.2} style={{ flex: wraps ? undefined : 1, ...typeScale.title2, color: c.text }}>
      {title}<Text style={{ ...typeScale.callout, fontFamily: fonts.regular, color: c.muted }}>{`  ${count}`}</Text>
    </Text>
    <Text key={`a${fontScale}`} maxFontSizeMultiplier={2} style={{ ...typeScale.subhead, fontFamily: fonts.semibold, color: c.accentText }}>{action}</Text>
  </PressTarget>;
}

/** A square cover with the timing on it and the title underneath, for the "For week 37" shelf. */
function ShelfCard({ record }: { record: BabyRecord }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), title = sourceTitle(record), timing = timingLabel(record.data.relevance),
    thumbnail = safeThumbnail(record), [broken, setBroken] = useState(false);
  return <PressTarget accessibilityRole="button" accessibilityLabel={[title, timing].filter(Boolean).join(". ")}
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })} style={{ width: SHELF_CARD, gap: 8 }}>
    <View style={{ width: SHELF_CARD, height: SHELF_CARD, borderRadius: radii.tile, overflow: "hidden" }}>
      <Cover title={title} size={SHELF_CARD} />
      {thumbnail && !broken && <Image source={{ uri: thumbnail }} style={{ position: "absolute", width: SHELF_CARD, height: SHELF_CARD }}
        cachePolicy="memory" contentFit="cover" transition={150} onError={() => setBroken(true)} />}
      {!!timing && <View style={{ position: "absolute", left: 10, bottom: 10, right: 10, flexDirection: "row" }}>
        <Text key={fontScale} numberOfLines={1} maxFontSizeMultiplier={1.4}
          style={{ ...typeScale.caption, fontFamily: fonts.semibold, color: "#FFFFFF", backgroundColor: "rgba(30,22,19,0.62)",
            borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 4, fontVariant: ["tabular-nums"] }}>{timing}</Text>
      </View>}
    </View>
    <Text key={`t${fontScale}`} numberOfLines={2} maxFontSizeMultiplier={1.6} style={{ ...typeScale.subhead, fontFamily: fonts.semibold, color: c.text }}>{title}</Text>
  </PressTarget>;
}

/** Posts timed for where she is now. At the largest text sizes the covers become ordinary rows. */
export function NowShelf({ title, rows, count, pending, onSeeAll }: { title: string; rows: BabyRecord[]; count: number;
  pending: (id: string) => boolean; onSeeAll: () => void }) {
  const { fontScale } = useWindowDimensions();
  if (!rows.length) return null;
  return <View style={{ gap: 10 }}>
    <SectionHeading title={title} count={count} onPress={onSeeAll} />
    {fontScale >= 2 ? <Grouped separatorInset={16}>{rows.slice(0, 3).map((row) => <SavedPostRow key={row.id} record={row} pending={pending(row.id)} />)}</Grouped>
      : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
        {rows.slice(0, 10).map((row) => <ShelfCard key={row.id} record={row} />)}
      </ScrollView>}
  </View>;
}

/** All saved by topic: each category's newest posts, then the posts not in one yet. `extra` adds a line under a row (a suggestion). */
export function SavedSections({ sections, unsorted, pending, onOpenCategory, onSeeUnsorted, extra }: {
  sections: SavedSection[]; unsorted: { count: number; rows: BabyRecord[] }; pending: (id: string) => boolean;
  onOpenCategory: (id: string) => void; onSeeUnsorted: () => void; extra?: (record: BabyRecord) => ReactNode;
}) {
  const { fontScale } = useWindowDimensions(), inset = fontScale >= 2 ? 16 : 94;
  return <>
    {sections.map(({ category, count, rows }) => <View key={category.id} style={{ gap: 10 }}>
      <SectionHeading title={category.title} count={count} onPress={() => onOpenCategory(category.id)} />
      <Grouped separatorInset={inset}>{rows.map((row) => <SavedPostRow key={row.id} record={row} pending={pending(row.id)} />)}</Grouped>
    </View>)}
    {unsorted.count > 0 && <View style={{ gap: 10 }}>
      <SectionHeading title="Not sorted yet" count={unsorted.count} action="Sort" onPress={onSeeUnsorted} />
      <Grouped separatorInset={inset}>{unsorted.rows.map((row) => <Fragment key={row.id}>
        <SavedPostRow record={row} pending={pending(row.id)} />
        {extra?.(row)}
      </Fragment>)}</Grouped>
    </View>}
  </>;
}

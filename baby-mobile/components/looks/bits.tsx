import { useState, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import type { BabyRecord } from "@/lib/models";
import { useBaby } from "@/lib/context";
import { useLook, useLookColors } from "@/lib/look-context";
import { displayFace, topicIndex, uiFace } from "@/lib/looks";
import { timingLabel, tipTopic } from "@/lib/timing";
import { Icon, cardEdge, type IconName } from "@/components/ui";

/** A quiet line icon per topic, matched on the words Kami uses; the label is always shown next to it. */
export function topicIcon(topic: string): IconName {
  const t = topic.toLowerCase();
  if (/bag|pack|hospital/.test(t)) return "bag-handle-outline";
  if (/sleep|night|nap/.test(t)) return "moon-outline";
  if (/feed|breast|bottle|milk|nurs/.test(t)) return "water-outline";
  if (/labou?r|birth|deliver/.test(t)) return "heart-outline";
  if (/rest|recover|postpartum|support|family/.test(t)) return "leaf-outline";
  if (/doctor|visit|appoint|health|clinic/.test(t)) return "medkit-outline";
  if (/food|eat|nutrition|tea|recipe/.test(t)) return "cafe-outline";
  if (/gear|buy|registry|product/.test(t)) return "cart-outline";
  if (/marriage|relationship|partner/.test(t)) return "people-outline";
  return "bookmark-outline";
}
/** The record's topic (her category first, then its AI topic). */
export function useTopic(record: Pick<BabyRecord, "id" | "data">) {
  const records = useBaby().records;
  return tipTopic(record, records.filter((row) => row.kind === "collection"));
}
/** A stable muted tint for a topic. */
export function useTopicTint(topic: string) {
  const c = useLookColors();
  return c.topics[topicIndex(topic || "saved", c.topics.length)] ?? { wash: c.tile, fill: c.accent, ink: c.accentText };
}
export function initialOf(text: string) {
  return (Array.from(text.replace(/[^\p{L}\p{N}]/gu, ""))[0] ?? "•").toLocaleUpperCase();
}
export function safeThumbnail(record: BabyRecord) {
  try {
    const url = new URL(record.data.thumbnail_url ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}

/** A washi-tape strip in the topic colour (Scrapbook); decoration only. */
export function Tape({ topic, index = 0, width = 44 }: { topic: string; index?: number; width?: number }) {
  const tint = useTopicTint(topic);
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ position: "absolute", top: -7, left: 18 + (index % 3) * 6, width, height: 14, borderRadius: 2, opacity: 0.85,
      backgroundColor: tint.fill, transform: [{ rotate: index % 2 ? "3deg" : "-4deg" }] }} />;
}

/** What a source tile shows when it has no thumbnail (and under one while it loads). */
export function Placeholder({ record, size, mark, fill }: { record: BabyRecord; size: number; mark: ReactNode; fill?: string }) {
  const { look } = useLook(), c = useLookColors(), topic = useTopic(record), tint = useTopicTint(topic);
  const title = record.title || record.data.creator || topic;
  switch (look.variants.placeholder) {
    case "monogram": return <View style={{ position: "absolute", inset: 0, backgroundColor: fill ?? c.placeholder, alignItems: "center", justifyContent: "center" }}>
      <Text allowFontScaling={false} style={{ ...displayFace(look, true), fontSize: size * 0.46, lineHeight: size * 0.56, color: c.placeholderInk }}>{initialOf(title)}</Text>
    </View>;
    case "stamp": return <View style={{ position: "absolute", inset: 0, backgroundColor: tint.wash, alignItems: "center", justifyContent: "center" }}>
      <Text allowFontScaling={false} style={{ ...displayFace(look), fontSize: size * 0.42, lineHeight: size * 0.52, color: tint.ink }}>{initialOf(title)}</Text>
    </View>;
    // One neutral tile with the topic's icon: lists stay calm and the two-tint limit holds on every screen.
    case "topic": return <View style={{ position: "absolute", inset: 0, backgroundColor: fill ?? c.placeholder, alignItems: "center", justifyContent: "center" }}>
      <Icon name={topicIcon(topic)} size={Math.round(size * 0.4)} color={c.placeholderInk} />
    </View>;
    default: return <>{mark}</>;
  }
}

/** Journal and doctor-question rows lead with their date instead of the same book glyph on every row. */
export function DateBlock({ iso }: { iso: string }) {
  const { look } = useLook(), c = useLookColors(), date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return <View accessible={false} style={{ width: 44, minHeight: 44, borderRadius: Math.min(12, look.radii.thumb + 2), backgroundColor: c.placeholder,
    alignItems: "center", justifyContent: "center", paddingVertical: 4 }}>
    <Text allowFontScaling={false} style={{ ...uiFace(look, "bold"), fontSize: 10, lineHeight: 12, letterSpacing: 0.6, color: c.placeholderInk }}>
      {date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
    </Text>
    <Text allowFontScaling={false} style={{ ...displayFace(look), fontSize: 20, lineHeight: 24, color: c.text, fontVariant: ["tabular-nums"] }}>{date.getDate()}</Text>
  </View>;
}

/** The top of a saved tip: its photo (or a designed stand-in), topic and title in the look's display voice. */
export function DetailHero({ record, title }: { record: BabyRecord; title: string }) {
  const { look } = useLook(), c = useLookColors(), { fontScale, width } = useWindowDimensions(), topic = useTopic(record), tint = useTopicTint(topic),
    thumbnail = safeThumbnail(record), [broken, setBroken] = useState(false), photo = !!thumbnail && !broken;
  const meta = [timingLabel(record.data.relevance), topic].filter(Boolean).join(" · ");
  const heading = <Text accessibilityRole="header" maxFontSizeMultiplier={1.6}
    style={{ ...displayFace(look), fontSize: look.id === "scrapbook" ? 25 : 27, lineHeight: look.id === "scrapbook" ? 32 : 33, color: c.text }}>{title}</Text>;
  const metaLine = !!meta && <Text maxFontSizeMultiplier={2} style={{ ...uiFace(look, "medium"), fontSize: 14, lineHeight: 19, color: look.id === "warm" ? tint.ink : c.muted }}>{meta}</Text>;
  const image = (style: object) => photo
    ? <Image source={{ uri: thumbnail }} accessibilityIgnoresInvertColors contentFit="cover" transition={200} onError={() => setBroken(true)} style={style} />
    : null;
  if (look.variants.detailHero === "frame") {
    // A taped instant photo, slightly askew; text below stays straight and calm.
    const frame = Math.min(260, width * 0.62);
    return <View style={{ gap: 14 }}>
      {photo && <View style={{ alignSelf: "center", marginTop: 10, transform: [{ rotate: "-1.5deg" }] }}>
        <View style={{ backgroundColor: c.frame, padding: 8, paddingBottom: 30, borderRadius: 3, ...cardEdge(c.cardBorder, look) }}>
          {image({ width: frame, height: frame * 1.1, borderRadius: 2 })}
        </View>
        <Tape topic={topic} width={64} />
      </View>}
      {metaLine}
      {heading}
    </View>;
  }
  if (look.variants.detailHero === "band") return <View style={{ gap: 14 }}>
    {photo && image({ width: "100%", aspectRatio: 16 / 10, borderRadius: look.radii.hero })}
    <View style={{ backgroundColor: tint.wash, borderRadius: look.radii.card, padding: 18, gap: 10 }}>
      {!!topic && <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" }}>
          <Icon name={topicIcon(topic)} size={16} color={tint.ink} />
        </View>
        <Text maxFontSizeMultiplier={2} style={{ ...uiFace(look, "semibold"), fontSize: 14, lineHeight: 19, color: tint.ink, flexShrink: 1 }}>{topic}</Text>
      </View>}
      {heading}
      {!!timingLabel(record.data.relevance) && <Text maxFontSizeMultiplier={2} style={{ ...uiFace(look, "regular"), fontSize: 14, lineHeight: 19, color: c.muted }}>
        {timingLabel(record.data.relevance)}</Text>}
    </View>
  </View>;
  // Soft: a rounded photo, or a blush card with the monogram when there is none.
  return <View style={{ gap: 12 }}>
    {photo ? image({ width: "100%", aspectRatio: 16 / 10, borderRadius: look.radii.hero })
      : <View style={{ height: 120 * Math.min(fontScale, 1.3), borderRadius: look.radii.hero, backgroundColor: c.hero, alignItems: "center", justifyContent: "center" }}>
        <Text allowFontScaling={false} style={{ ...displayFace(look, true), fontSize: 56, lineHeight: 64, color: c.placeholderInk }}>{initialOf(title)}</Text>
      </View>}
    {metaLine}
    {heading}
  </View>;
}

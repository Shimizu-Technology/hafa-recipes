import { useState } from "react";
import { sourceTitle } from "@/lib/source-title";
import { Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { BabyRecord } from "@/lib/models";
import { timingLabel } from "@/lib/timing";
import { savedWhen } from "../lib/source-reading";
import { Copy, Icon, PressTarget, fonts, radii, typeScale, useColors, type IconName } from "./ui";

const labels: Record<string, string> = {
  saved: "Original saved", queued: "Waiting to process", processing: "Processing…",
  ready: "", incomplete: "Couldn’t read everything · Open to retry", failed: "Original saved · processing needs another try",
  cancelled: "Original saved · processing stopped",
};
// Originals remain saved when optional organization fails; describe that state precisely.
const updates: Record<string, string> = {
  queued: "Waiting to organize…", processing: "Organizing…",
  failed: "Couldn’t organize · Review", incomplete: "Couldn’t read everything · Open to retry", cancelled: "Organizing stopped",
};
/** An https thumbnail without credentials, or nothing: a thumbnail is optional and the post stays readable. */
export function safeThumbnail(record: BabyRecord) {
  try {
    const url = new URL(record.data.thumbnail_url ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}
/** Where a post came from: its stated platform, or one read from its link. A private note has none. */
export function platformName(record: Pick<BabyRecord, "data">) {
  if (record.data.platform) return record.data.platform;
  try {
    const url = new URL(record.data.url ?? ""), host = url.hostname.toLowerCase();
    if (!["https:", "http:"].includes(url.protocol)) return undefined;
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") ? "YouTube"
      : host === "instagram.com" || host.endsWith(".instagram.com") ? "Instagram"
      : host === "tiktok.com" || host.endsWith(".tiktok.com") ? "TikTok" : "Website";
  } catch { return undefined; }
}
/** The first letter or digit of a title, for a monogram tile. */
export function initialOf(text: string) {
  return (Array.from(text.replace(/[^\p{L}\p{N}]/gu, ""))[0] ?? "•").toLocaleUpperCase();
}
/**
 * A source without a photo gets a blush tile with its italic Newsreader initial instead of a grey platform glyph;
 * it also sits under a loading or broken thumbnail, so the tile is never empty. Decorative: the row is labelled.
 */
export function Monogram({ title, size, fill }: { title: string; size: number; fill?: string }) {
  const c = useColors();
  return <View accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ position: "absolute", top: 0, left: 0, width: size, height: size, backgroundColor: fill ?? c.placeholder, alignItems: "center", justifyContent: "center" }}>
    <Text allowFontScaling={false} style={{ fontFamily: fonts.displayItalic, fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.56), color: c.placeholderInk }}>
      {initialOf(title)}
    </Text>
  </View>;
}
/** `meta` replaces the default "timing · creator · platform" line, for example with a topic on Today. */
export function SavedPostRow({ record, pending, meta }: { record: BabyRecord; pending: boolean; meta?: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), title = sourceTitle(record),
    // At accessibility sizes the thumbnail sits above the text so long words keep the full width.
    stacked = fontScale >= 2,
    status = pending ? "Saved on this device" : labels[record.data.status ?? ""] ?? "Saved",
    update = pending ? status : updates[record.data.status ?? ""];
  const identity = platformName(record);
  const thumbnail = safeThumbnail(record);
  const [failed, setBroken] = useState<string>(), broken = !!thumbnail && failed === thumbnail;
  return <PressTarget accessibilityRole="button" accessibilityLabel={[title, record.data.creator, identity, status].filter(Boolean).join(". ")}
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    style={({ pressed }) => ({ minHeight: 80, flexDirection: stacked ? "column" : "row", gap: 12, alignItems: "flex-start",
      paddingVertical: 12, paddingHorizontal: 16, backgroundColor: c.surface })}>
    <View style={{ width: 56, height: 56, borderRadius: radii.thumb, overflow: "hidden" }}>
      <Monogram title={title} size={56} />
      {thumbnail && !broken && <Image source={{ uri: thumbnail }} style={{ position: "absolute", width: 56, height: 56 }}
        cachePolicy="memory" contentFit="cover" transition={150} onError={() => setBroken(thumbnail)} />}
    </View>
    <View style={{ flex: stacked ? undefined : 1, minWidth: 0, alignSelf: stacked ? "stretch" : undefined, gap: 4 }}>
      <Copy kind="label" lines={fontScale >= 1.3 ? undefined : 2}>{title}</Copy>
      <Copy kind="small" tone={!pending && record.data.status === "failed" ? "error" : "muted"} lines={fontScale >= 1.3 ? undefined : 1}>
        {update || meta || [timingLabel(record.data.relevance), record.data.creator, identity].filter(Boolean).join(" · ") || "Saved source"}
      </Copy>
    </View>
    {!stacked && <View style={{ paddingTop: 3 }}><Icon name="chevron-forward" size={16} color={c.muted} /></View>}
  </PressTarget>;
}

/** A small filled tag with an icon, for a tip's timing or category. */
export function Pill({ icon, label }: { icon: IconName; label: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: c.soft, maxWidth: "100%" }}>
    <Icon name={icon} size={Math.round(14 * Math.min(fontScale, 1.6))} color={c.muted} />
    <Text key={fontScale} maxFontSizeMultiplier={2} style={{ ...typeScale.footnote, fontFamily: fonts.semibold, color: c.text, fontVariant: ["tabular-nums"], flexShrink: 1 }}>{label}</Text>
  </View>;
}

/**
 * The top of a saved tip: its photo at full width when it has one, then its timing and her topic as pills, the
 * title in Newsreader, and who posted it where and when she saved it.
 */
export function SourceHero({ record, title, topic, distance }: { record: BabyRecord; title: string; topic: string; distance?: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), thumbnail = safeThumbnail(record), [broken, setBroken] = useState(false),
    timing = timingLabel(record.data.relevance),
    meta = [record.data.creator, platformName(record), savedWhen(record.created_at || record.occurred_at)].filter(Boolean).join(" · ");
  return <View style={{ gap: 12 }}>
    {thumbnail && !broken && <Image source={{ uri: thumbnail }} accessibilityIgnoresInvertColors contentFit="cover" transition={200} onError={() => setBroken(true)}
      style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: radii.hero, backgroundColor: c.placeholder }} />}
    {!!(timing || topic) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {!!timing && <Pill icon="calendar-outline" label={[timing, distance].filter(Boolean).join(" · ")} />}
      {!!topic && <Pill icon="folder-outline" label={topic} />}
    </View>}
    <Text key={fontScale} accessibilityRole="header" maxFontSizeMultiplier={0}
      style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: c.text }}>{title}</Text>
    {!!meta && <Copy kind="small" tone="muted">{meta}</Copy>}
  </View>;
}

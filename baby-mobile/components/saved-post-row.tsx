import { useState } from "react";
import { sourceTitle } from "@/lib/source-title";
import { Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { BabyRecord } from "@/lib/models";
import { timingLabel } from "@/lib/timing";
import { Copy, Icon, PressTarget, fonts, radii, useColors } from "./ui";

const labels: Record<string, string> = {
  saved: "Original saved", queued: "Waiting to process", processing: "Processing…",
  ready: "", incomplete: "Some details unavailable", failed: "Original saved · processing needs another try",
  cancelled: "Original saved · processing stopped",
};
// Originals remain saved when optional organization fails; describe that state precisely.
const updates: Record<string, string> = {
  queued: "Waiting to organize…", processing: "Organizing…",
  failed: "Couldn’t organize · Review", incomplete: "Some details unavailable", cancelled: "Organizing stopped",
};
/** An https thumbnail without credentials, or nothing: a thumbnail is optional and the post stays readable. */
export function safeThumbnail(record: BabyRecord) {
  try {
    const url = new URL(record.data.thumbnail_url ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
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
  let inferred: string | undefined;
  try {
    const url = new URL(record.data.url ?? "");
    const host = url.hostname.toLowerCase();
    if (["https:", "http:"].includes(url.protocol))
      inferred = host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") ? "YouTube"
        : host === "instagram.com" || host.endsWith(".instagram.com") ? "Instagram"
        : host === "tiktok.com" || host.endsWith(".tiktok.com") ? "TikTok" : "Website";
  } catch { /* A private note has no external platform. */ }
  const identity = record.data.platform || inferred;
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

/**
 * The top of a saved tip: its photo at full width, or a blush card with the monogram when there is none, then the
 * stated timing and her topic, and the title in Newsreader.
 */
export function SourceHero({ record, title, topic }: { record: BabyRecord; title: string; topic: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), thumbnail = safeThumbnail(record), [broken, setBroken] = useState(false),
    meta = [timingLabel(record.data.relevance), topic].filter(Boolean).join(" · ");
  return <View style={{ gap: 12 }}>
    {thumbnail && !broken
      ? <Image source={{ uri: thumbnail }} accessibilityIgnoresInvertColors contentFit="cover" transition={200} onError={() => setBroken(true)}
        style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: radii.hero, backgroundColor: c.placeholder }} />
      : <View accessible={false} style={{ height: Math.round(120 * Math.min(fontScale, 1.3)), borderRadius: radii.hero, backgroundColor: c.hero,
        alignItems: "center", justifyContent: "center" }}>
        <Text allowFontScaling={false} style={{ fontFamily: fonts.displayItalic, fontSize: 56, lineHeight: 64, color: c.placeholderInk }}>{initialOf(title)}</Text>
      </View>}
    {!!meta && <Copy numeric kind="small" tone="muted">{meta}</Copy>}
    <Text key={fontScale} accessibilityRole="header" maxFontSizeMultiplier={0}
      style={{ fontFamily: fonts.display, fontSize: 27, lineHeight: 33, color: c.text }}>{title}</Text>
  </View>;
}

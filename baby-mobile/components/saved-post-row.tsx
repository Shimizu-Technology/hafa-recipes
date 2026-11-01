import { sourceTitle } from "@/lib/source-title";
import { View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { BabyRecord } from "@/lib/models";
import { timingLabel } from "@/lib/timing";
import { Copy, Icon, PressTarget, useColors, type IconName } from "./ui";

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
  const platform = identity?.toLowerCase() ?? (record.data.source_text ? "note" : "");
  const marks: Record<string, IconName> = { instagram: "logo-instagram", youtube: "logo-youtube", tiktok: "logo-tiktok",
    web: "globe-outline", website: "globe-outline", manual: "document-text-outline", note: "document-text-outline",
    image: "image-outline", document: "document-text-outline" };
  let thumbnail: string | undefined;
  try { const url = new URL(record.data.thumbnail_url ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) thumbnail = url.toString();
  } catch { /* A thumbnail is optional; the saved post stays readable. */ }
  return <PressTarget accessibilityRole="button" accessibilityLabel={[title, record.data.creator, identity, status].filter(Boolean).join(". ")}
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    style={({ pressed }) => ({ minHeight: 80, flexDirection: stacked ? "column" : "row", gap: 12, alignItems: stacked ? "flex-start" : "center",
      padding: 12, backgroundColor: c.surface })}>
    <View style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", backgroundColor: c.tile,
      alignItems: "center", justifyContent: "center" }}>
      {thumbnail ? <Image source={{ uri: thumbnail }} style={{ width: 56, height: 56 }} cachePolicy="none" contentFit="cover" />
        : <Icon name={marks[platform] ?? "bookmark-outline"} size={23} />}
    </View>
    <View style={{ flex: stacked ? undefined : 1, alignSelf: stacked ? "stretch" : undefined, gap: 4 }}>
      <Copy kind="label" lines={fontScale >= 1.3 ? undefined : 2}>{title}</Copy>
      <Copy kind="small" tone={!pending && record.data.status === "failed" ? "error" : "muted"} lines={fontScale >= 1.3 ? undefined : 1}>
        {update || meta || [timingLabel(record.data.relevance), record.data.creator, identity].filter(Boolean).join(" · ") || "Saved source"}
      </Copy>
    </View>
    {!stacked && <Icon name="chevron-forward" size={16} color={c.muted} />}
  </PressTarget>;
}

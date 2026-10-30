import { sourceTitle } from "@/lib/source-title";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { BabyRecord } from "@/lib/models";
import { Copy, Icon, useColors, type IconName } from "./ui";

const labels: Record<string, string> = {
  saved: "Original saved", queued: "Waiting to process", processing: "Processing…",
  ready: "", incomplete: "Some details unavailable", failed: "Original saved · processing needs another try",
  cancelled: "Original saved · processing stopped",
};
export function SavedPostRow({ record, pending }: { record: BabyRecord; pending: boolean }) {
  const c = useColors(), title = sourceTitle(record),
    status = pending ? "Saved on this device" : labels[record.data.status ?? ""] ?? "Saved";
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
  return <Pressable accessibilityRole="button" accessibilityLabel={[title, record.data.creator, identity, status].filter(Boolean).join(". ")}
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    style={({ pressed }) => ({ minHeight: 90, flexDirection: "row", gap: 13, alignItems: "center",
      paddingVertical: 14, borderBottomWidth: 1, borderColor: c.border, opacity: pressed ? 0.65 : 1 })}>
    <View style={{ width: 54, height: 68, borderRadius: 12, overflow: "hidden", backgroundColor: c.tile,
      alignItems: "center", justifyContent: "center" }}>
      {thumbnail ? <Image source={{ uri: thumbnail }} style={{ width: 54, height: 68 }} cachePolicy="none" contentFit="cover" />
        : <Icon name={marks[platform] ?? "bookmark-outline"} size={23} />}
    </View>
    <View style={{ flex: 1, gap: 4 }}>
      <Copy kind="label">{title}</Copy>
      {!!(record.data.creator || identity) && <Copy kind="small" tone="muted" lines={1}>
        {[record.data.creator, identity].filter(Boolean).join(" · ")}
      </Copy>}
      {!!status && <Copy kind="small" tone="muted">{status}</Copy>}
    </View>
    <Icon name="chevron-forward" size={16} />
  </Pressable>;
}

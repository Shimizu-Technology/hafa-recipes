import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { BabyRecord } from "@/lib/models";
import { Copy, Icon, useColors } from "./ui";

const labels: Record<string, string> = {
  saved: "Original saved", queued: "Waiting to process", processing: "Processing…",
  ready: "Ready to read", incomplete: "Some details unavailable", failed: "Original saved · processing needs another try",
  cancelled: "Original saved · processing stopped",
};
export function SavedPostRow({ record, pending }: { record: BabyRecord; pending: boolean }) {
  const c = useColors(), status = pending ? "Saved on this device" : labels[record.data.status ?? ""] || "Saved";
  let thumbnail: string | undefined;
  try { const url = new URL(record.data.thumbnail_url ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) thumbnail = url.toString();
  } catch { /* A thumbnail is optional; the saved post stays readable. */ }
  return <Pressable accessibilityRole="button" accessibilityLabel={`${record.title}. ${status}`}
    onPress={() => router.push({ pathname: "/record/[id]", params: { id: record.id } })}
    style={({ pressed }) => ({ minHeight: 90, flexDirection: "row", gap: 13, alignItems: "center",
      paddingVertical: 14, borderBottomWidth: 1, borderColor: c.border, opacity: pressed ? 0.65 : 1 })}>
    <View style={{ width: 54, height: 68, borderRadius: 12, overflow: "hidden", backgroundColor: c.tile,
      alignItems: "center", justifyContent: "center" }}>
      {thumbnail ? <Image source={{ uri: thumbnail }} style={{ width: 54, height: 68 }} cachePolicy="none" contentFit="cover" />
        : <Icon name="bookmark-outline" size={23} />}
    </View>
    <View style={{ flex: 1, gap: 4 }}>
      <Copy kind="label" lines={3}>{record.title}</Copy>
      {!!(record.data.creator || record.data.platform) && <Copy kind="small" tone="muted" lines={1}>
        {[record.data.creator, record.data.platform].filter(Boolean).join(" · ")}
      </Copy>}
      <Copy kind="small" tone="muted">{status}</Copy>
    </View>
    <Icon name="chevron-forward" size={16} />
  </Pressable>;
}

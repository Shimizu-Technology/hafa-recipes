import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Copy, useColors } from "@/components/ui";
import { radii } from "@/constants/theme";
import type { ReviewNotice } from "@/lib/import-review";

/**
 * What to check before saving, one line each. A line that belongs to a part names it and jumps to it,
 * so the person never has to hunt through the page for what the warning means.
 */
export function ReviewChecklist({ notices, fallback, onOpen }: { notices: ReviewNotice[]; fallback?: string; onOpen(blockId: string): void }) {
  const c = useColors();
  return (
    <View accessibilityRole="summary" style={{ padding: 14, gap: 10, borderRadius: radii.md, backgroundColor: c.sunken }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Ionicons name="alert-circle-outline" size={20} color={c.warning} />
        <Copy kind="label" style={{ flex: 1 }}>{notices.length ? "Check before saving" : "Check against your source"}</Copy>
      </View>
      {!notices.length && !!fallback && <Copy kind="small">{fallback}</Copy>}
      {notices.map((notice, index) => {
        const jump = notice.blockId;
        const body = <Copy kind="small">{notice.part ? <Copy kind="small" style={{ fontWeight: "600" }}>{notice.part} · </Copy> : null}{notice.text}</Copy>;
        return jump ? (
          <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${notice.part}: ${notice.text}`} accessibilityHint="Goes to that part"
            onPress={() => onOpen(jump)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
            <View style={{ flex: 1 }}>{body}</View>
            <Ionicons name="chevron-down" size={18} color={c.muted} />
          </Pressable>
        ) : <View key={index}>{body}</View>;
      })}
    </View>
  );
}

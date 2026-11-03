import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, Path } from "react-native-svg";
import { useLook } from "@/lib/look-context";
import { Copy, useColors } from "./design/foundation";
import { BrandMark } from "./brand-mark";
/** Coverless imports are designed content, not an image loading state. */
export function WorkoutArt({ title, meta = "", compact = false }: { title: string; meta?: string; compact?: boolean }) {
  const look = useLook(), c = useColors();
  const athletic = look.id === "athletic", coach = look.id === "coach";
  const format = meta.replace(/\s*·.*/, "").toUpperCase();
  const number = format.match(/\d+/)?.[0];
  const label = format.replace(/\d+/, "").trim() || "TRAIN";
  if (look.id === "pro" && !compact) return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ flex: 1, backgroundColor: c.sunken, padding: 16, gap: 8, justifyContent: "center" }}>
    <Copy kind="numeric" maxScale={1.5} style={{ fontSize: 32, lineHeight: 36 }}>{number ?? "GO"}</Copy>
    <Copy kind="caption2" maxScale={1.5} numberOfLines={2} style={{ fontSize: 13, lineHeight: 18 }}>{label}</Copy>
  </View>;
  return <View style={{ flex: 1, backgroundColor: c.sunken, padding: compact ? 8 : 18, justifyContent: "space-between", gap: 12 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={{ position: "absolute", inset: 0 }}><Svg width="100%" height="100%" viewBox="0 0 200 250" preserveAspectRatio="none">
      <Defs><LinearGradient id="cover" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={athletic ? c.surface : c.sunken} /><Stop offset="1" stopColor={c.background} /></LinearGradient></Defs>
      <Rect width="200" height="250" fill="url(#cover)" />
      <Path d={coach ? "M-40 170 Q100 0 250 150 M-40 200 Q100 30 250 180" : "M80 -20 L-40 250 M130 -20 L10 250 M180 -20 L60 250 M230 -20 L110 250"} stroke={c.border} strokeWidth={coach ? 18 : 1} fill="none" opacity={coach ? 0.32 : 0.5} />
    </Svg></View>
    {!compact && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><BrandMark height={18} mono={c.text} /><Copy kind="caption2" tone="muted">HÅFA</Copy></View>}
    <View style={{ flex: 1, justifyContent: "center", gap: compact ? 0 : 4 }}>
      <Copy kind={athletic ? "numeric" : "heading"} maxScale={1.5} style={{ fontSize: compact ? 22 : athletic ? 72 : coach ? 48 : 40, lineHeight: compact ? 27 : athletic ? 76 : coach ? 54 : 46 }}>{number ?? (coach ? "Move" : "GO")}</Copy>
      <Copy kind="caption2" maxScale={1.5} style={{ fontSize: compact ? 10 : 13, lineHeight: compact ? 13 : 18 }}>{label}</Copy>
    </View>
  </View>;
}

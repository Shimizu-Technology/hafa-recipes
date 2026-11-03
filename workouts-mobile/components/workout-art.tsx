import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, Path } from "react-native-svg";
import { Copy, useColors } from "./design/foundation";
import { BrandMark } from "./brand-mark";
import { formatNumeral } from "@/lib/format-numeral";
/** Coverless imports are designed content, not an image loading state. */
export function WorkoutArt({ title, meta = "", compact = false }: { title: string; meta?: string; compact?: boolean }) {
  const c = useColors();
  const format = meta.replace(/\s*·.*/, "").toUpperCase();
  const { numeral: number, caption } = formatNumeral(format);
  const label = caption || "TRAIN";
  return <View style={{ flex: 1, backgroundColor: c.sunken, padding: compact ? 8 : 18, justifyContent: "space-between", gap: 12 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={{ position: "absolute", inset: 0 }}><Svg width="100%" height="100%" viewBox="0 0 200 250" preserveAspectRatio="none">
      <Defs><LinearGradient id="cover" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={c.surface} /><Stop offset="1" stopColor={c.background} /></LinearGradient></Defs>
      <Rect width="200" height="250" fill="url(#cover)" />
      <Path d={"M80 -20 L-40 250 M130 -20 L10 250 M180 -20 L60 250 M230 -20 L110 250"} stroke={c.border} strokeWidth={1} fill="none" opacity={0.5} />
    </Svg></View>
    {!compact && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><BrandMark height={18} mono={c.text} /><Copy kind="caption2" tone="muted" maxScale={1.2}>HÅFA</Copy></View>}
    <View style={{ flex: 1, justifyContent: "center", gap: compact ? 0 : 4 }}>
      <Copy kind="numeric" maxScale={compact ? 1 : 1.5} style={{ fontSize: compact ? 22 : 72, lineHeight: compact ? 27 : 76 }}>{number ?? "GO"}</Copy>
      <Copy kind="caption2" maxScale={compact ? 1 : 1.5} style={{ fontSize: compact ? 10 : 13, lineHeight: compact ? 13 : 18 }}>{label}</Copy>
    </View>
  </View>;
}

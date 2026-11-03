import { type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Copy, useColors } from "../design/foundation";
import { useLook } from "@/lib/look-context";
import { ProgressRing } from "../design/training";
import { LookPop } from "../design/look-motion";
export function LookClock({ text, caption, phase, progress, trigger, compact, children, accessibilityLabel }: { accessibilityLabel?: string; text: string; caption: string; phase?: string | null; progress: number | null; trigger: unknown; compact: boolean; children: ReactNode }) {
  const c = useColors(), look = useLook();
  const { width, fontScale } = useWindowDimensions();
  const ring = look.id !== "pro" && !compact && progress != null;
  const ringSize = look.id === "athletic" ? 212 : 188;
  const size = Math.min((compact ? 52 : look.id === "athletic" ? 92 : 64) * Math.min(fontScale, 1.6), (ring ? ringSize - 32 : width - 64) / (text.length * (look.id === "athletic" ? 0.44 : 0.58)));
  const clock = <View style={{ alignItems: "center", gap: 2 }}>
    {!!phase && <Copy kind="small" tone="muted" maxScale={compact ? 1.5 : undefined}>{phase}</Copy>}
    <Copy kind="numeric" accessibilityLabel={accessibilityLabel} allowFontScaling={false} style={{ fontSize: size, lineHeight: Math.ceil(size * 1.12) }}>{text}</Copy>
  </View>;
  return <View style={{ gap: compact ? 6 : 16, paddingVertical: compact ? 8 : 16, alignItems: "stretch" }}>
    <Copy kind="small" tone="muted" align="center" maxScale={compact ? 1.5 : undefined}>{caption}</Copy>
    <LookPop trigger={trigger}><View style={{ alignItems: "center" }}>{ring ? <ProgressRing progress={progress ?? 0} size={ringSize} stroke={look.id === "athletic" ? 4 : 7} color={c.text}>{clock}</ProgressRing> : clock}</View></LookPop>
    {children}
  </View>;
}

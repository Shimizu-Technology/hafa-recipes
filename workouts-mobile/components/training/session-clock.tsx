import { type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Copy, useColors } from "../design/foundation";
import { ProgressRing } from "../design/training";
import { SetPop } from "../design/athletic-motion";
export function SessionClock({ text, caption, phase, progress, trigger, compact, children, accessibilityLabel }: { accessibilityLabel: string; text: string; caption: string; phase?: string | null; progress: number | null; trigger: number; compact: boolean; children: ReactNode }) {
  const c = useColors();
  const { width, fontScale } = useWindowDimensions();
  const ring = !compact && progress != null;
  const ringSize = 212;
  const size = Math.min((compact ? 52 : 92) * Math.min(fontScale, 1.6), (ring ? ringSize - 32 : width - 64) / (text.length * (0.44)));
  const clock = <View style={{ alignItems: "center", gap: 2 }}>
    {!!phase && <Copy kind="small" tone="muted" accessibilityLabel={`${phase} phase`} maxScale={compact ? 1.5 : undefined}>{phase}</Copy>}
    <Copy kind="numeric" accessibilityLabel={accessibilityLabel} numberOfLines={1} allowFontScaling={false} style={{ fontSize: size, lineHeight: Math.ceil(size * 1.12) }}>{text}</Copy>
  </View>;
  return <View style={{ gap: compact ? 6 : 16, paddingVertical: compact ? 8 : 16, alignItems: "stretch" }}>
    <Copy kind="small" tone="muted" align="center" maxScale={compact ? 1.5 : undefined}>{caption}</Copy>
    <SetPop trigger={trigger}><View style={{ alignItems: "center" }}>{ring ? <ProgressRing progress={progress ?? 0} size={ringSize} stroke={4} color={c.text}>{clock}</ProgressRing> : clock}</View></SetPop>
    {children}
  </View>;
}

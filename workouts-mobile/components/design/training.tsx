import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, View, type ColorValue } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radii, spacing } from "@/constants/theme";
import { Copy, useColors, useSurface } from "./foundation";
import { Button, type IconName } from "./controls";

/** A number front and centre with a short label (sessions this week, minutes, …). */
export function StatTile({
  value,
  label,
  unit,
  icon,
  tone = "plain",
}: {
  value: string | number;
  label: string;
  unit?: string;
  icon?: IconName;
  tone?: "plain" | "accent";
}) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ""}`}
      style={{
        flex: 1,
        minWidth: 96,
        padding: spacing.md,
        gap: 4,
        borderRadius: radii.lg,
        backgroundColor: tone === "accent" ? c.accentSoft : c.surface,
        borderWidth: tone === "accent" ? 0 : 1,
        borderColor: c.border,
      }}
    >
      {!!icon && <Ionicons name={icon} size={18} color={tone === "accent" ? c.accentText : c.onActionSoft} />}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Copy kind="numeric">{value}</Copy>
        {!!unit && (
          <Copy kind="label" tone="muted">
            {unit}
          </Copy>
        )}
      </View>
      <Copy kind="small" tone="muted">
        {label}
      </Copy>
    </View>
  );
}

/** Circular progress (rest timer, weekly target). */
export function ProgressRing({
  progress,
  size = 132,
  stroke = 12,
  color,
  children,
  accessibilityLabel,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const surface = useSurface();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={surface === "hero" ? c.onHeroSoft : c.sunken}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? (surface === "hero" ? c.heroAccent : c.accent)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - p)}
          fill="none"
        />
      </Svg>
      {children}
    </View>
  );
}

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Rest countdown from real timestamps (the caller passes remaining seconds).
 * The ring's full length is the longest remaining value seen for this rest.
 */
export function RestTimer({
  remaining,
  onSkip,
  onAdd,
}: {
  remaining: number;
  /** @deprecated no longer needed; the ring tracks the longest remaining time while mounted. */
  restKey?: string | number;
  onSkip(): void;
  onAdd?: () => void;
}) {
  // Full ring = longest remaining time seen while this timer is shown (+15 sec extends it, no jump).
  const [max, setMax] = useState(remaining);
  useEffect(() => setMax((m) => (remaining > m ? remaining : m)), [remaining]);
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return (
    <View style={{ alignItems: "center", gap: spacing.md }}>
      <ProgressRing
        progress={max ? remaining / Math.max(max, remaining) : 0}
        size={168}
        stroke={14}
        accessibilityLabel={`Rest, ${minutes ? `${minutes} minute${minutes === 1 ? "" : "s"} ` : ""}${secs} seconds remaining`}
      >
        <Copy kind="caption" tone="muted">
          Rest
        </Copy>
        <Copy kind="numeric" style={{ fontSize: 44, lineHeight: 50 }}>
          {formatClock(remaining)}
        </Copy>
      </ProgressRing>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" }}>
        {!!onAdd && (
          <View style={{ flex: 1 }}>
            <Button title="+15 sec" icon="add" variant="secondary" onPress={onAdd} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button title="End rest" icon="play-skip-forward" variant="secondary" onPress={onSkip} />
        </View>
      </View>
    </View>
  );
}

export type SetState = "done" | "skipped" | "current" | "upcoming";
/** One set in a session: big numerals, tap to act, previous-performance hint. */
export function SetRow({
  number,
  summary,
  hint,
  state,
  onPress,
  onLongPress,
}: {
  number: number | string;
  summary: string;
  hint?: string;
  state: SetState;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const c = useColors();
  const done = state === "done";
  const current = state === "current";
  const badgeBg = done ? c.action : current ? c.accent : state === "skipped" ? c.sunken : c.surface;
  const badgeFg = done ? c.onAction : current ? c.onAccent : c.muted;
  const label = `Set ${number}, ${summary}, ${{ done: "done", skipped: "skipped", current: "current set", upcoming: "upcoming" }[state]}`;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 60,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radii.lg - 4,
        backgroundColor: current ? c.accentSoft : "transparent",
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radii.full,
          backgroundColor: badgeBg,
          borderWidth: state === "upcoming" ? 1 : 0,
          borderColor: c.borderStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done ? (
          <Ionicons name="checkmark" size={22} color={badgeFg} />
        ) : state === "skipped" ? (
          <Ionicons name="remove" size={20} color={badgeFg} />
        ) : (
          <Copy kind="numericSmall" color={badgeFg} style={{ fontSize: 17 }}>
            {number}
          </Copy>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Copy kind="numericSmall" color={state === "skipped" ? c.muted : c.text} numberOfLines={2}>
          {summary}
        </Copy>
        {!!hint && (
          <Copy kind="small" tone="muted" numberOfLines={1}>
            {hint}
          </Copy>
        )}
      </View>
    </Pressable>
  );
}

export type DayMark = { label: string; state: "done" | "planned" | "today" | "rest"; accessibilityLabel: string };
/** This week at a glance: done, planned and today. No streak pressure. */
export function WeekStrip({ days }: { days: DayMark[] }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4 }}>
      {days.map((day, i) => {
        const done = day.state === "done";
        const today = day.state === "today";
        return (
          <View key={i} accessible accessibilityLabel={day.accessibilityLabel} style={{ alignItems: "center", gap: 6, flex: 1 }}>
            <Copy kind="caption" tone={today ? "accent" : "muted"} style={{ letterSpacing: 0.4 }}>
              {day.label}
            </Copy>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: radii.full,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: done ? c.action : day.state === "planned" ? c.actionSoft : "transparent",
                borderWidth: today ? 2 : day.state === "rest" ? 1 : 0,
                borderColor: today ? c.accent : c.border,
              }}
            >
              {done ? (
                <Ionicons name="checkmark" size={18} color={c.onAction} />
              ) : day.state === "planned" || today ? (
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: today ? c.accent : c.onActionSoft }} />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Tab-bar icon: filled glyph on a soft coral pill when active. */
export const tabIcons = {
  index: ["sunny", "sunny-outline"],
  discover: ["compass", "compass-outline"],
  library: ["albums", "albums-outline"],
  plan: ["calendar", "calendar-outline"],
  progress: ["stats-chart", "stats-chart-outline"],
} as const satisfies Record<string, readonly [IconName, IconName]>;
export function TabIcon({ route, focused, color }: { route: keyof typeof tabIcons; focused: boolean; color: ColorValue }) {
  const c = useColors();
  const [active, idle] = tabIcons[route];
  return (
    <View
      style={{
        width: 48,
        height: 26,
        borderRadius: radii.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? c.accentSoft : "transparent",
      }}
    >
      <Ionicons name={focused ? active : idle} size={21} color={color} />
    </View>
  );
}

/** Keeps a value's previous render (used for one-shot haptics on state changes). */
export function usePrevious<T>(value: T) {
  const ref = useRef<T>(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

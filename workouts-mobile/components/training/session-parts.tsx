import { AccessibilityInfo, Platform, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radii } from "@/constants/theme";
import type { SetMark } from "@/lib/training-view";
import { Button, Copy, Grow, Row, useColors } from "@/components/ui";

/** iOS has no live regions; announce changes explicitly there. Android uses accessibilityLiveRegion. */
export function announce(message: string) {
  if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
}

const stateWords = { done: "done", skipped: "skipped", current: "current", upcoming: "upcoming" } as const;

/** This exercise's sets at a glance: ticked when done, highlighted when current. */
export function SetProgress({ sets }: { sets: SetMark[] }) {
  const c = useColors();
  if (sets.length < 2) return null;
  return (
    <View accessible accessibilityLabel={`Sets: ${sets.map((s) => `${s.label} ${stateWords[s.state]}`).join(", ")}`}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {sets.map((s) => {
        const done = s.state === "done";
        const current = s.state === "current";
        return (
          <View key={s.key} style={{
            minWidth: 36, minHeight: 36, paddingHorizontal: 6, paddingVertical: 6, borderRadius: radii.full, alignItems: "center", justifyContent: "center",
            backgroundColor: done ? c.action : current ? c.accentSoft : "transparent",
            borderWidth: done ? 0 : current ? 2 : 1, borderColor: current ? c.accent : c.borderStrong,
          }}>
            {done ? <Ionicons name="checkmark" size={20} color={c.onAction} />
              : s.state === "skipped" ? <Ionicons name="remove" size={18} color={c.muted} />
              : <Copy kind="label" tone={current ? "accent" : "muted"}>{s.label}</Copy>}
          </View>
        );
      })}
    </View>
  );
}

/** Inline confirmation for the most recent logged set, with Undo. */
export function LastLogged({ title, summary, skipped = false, onUndo, disabled }: {
  title: string; summary: string; skipped?: boolean; onUndo?: () => void; disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Row gap={10} style={{ minHeight: 48 }}>
      <Ionicons name={skipped ? "remove-circle-outline" : "checkmark-circle"} size={24} color={skipped ? c.muted : c.success} />
      <Grow>
        <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${summary}`}>
          <Copy kind="label" numberOfLines={1}>{title}</Copy>
          <Copy kind="small" tone="muted" numberOfLines={1}>{summary}</Copy>
        </View>
      </Grow>
      {!!onUndo && <Button title="Undo" icon="arrow-undo" variant="ghost" size="sm" inline disabled={disabled} onPress={onUndo} />}
    </Row>
  );
}

/** Shown briefly when a rest reaches zero. */
export function RestDone({ next }: { next?: string | null }) {
  const c = useColors();
  return (
    <Row gap={12} style={{ minHeight: 56 }}>
      <Ionicons name="checkmark-circle" size={32} color={c.success} />
      <Grow>
        <View accessible accessibilityLiveRegion="assertive" accessibilityLabel={`Rest done.${next ? ` Next: ${next}` : ""}`}>
          <Copy kind="heading">Rest done</Copy>
          {!!next && <Copy kind="small" tone="muted" numberOfLines={1}>Next · {next}</Copy>}
        </View>
      </Grow>
    </Row>
  );
}

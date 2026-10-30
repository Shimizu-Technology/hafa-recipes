import { Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radii, spacing, typography } from "@/constants/theme";
import { parseEntry, stepValue } from "@/lib/training-view";
import { Copy, IconButton, Row, haptics, useColors } from "@/components/ui";

/**
 * One big number for set logging, sized to sit two-up (reps and weight side by side).
 * Type into it or use −/+. When `onLabelPress` is set, the label doubles as the
 * control for its unit (e.g. "Reps ⌄" switches to time or distance, "Weight · kg ⌄" changes kg/lb).
 */
export function SetNumberField({
  label,
  value,
  onChange,
  step,
  decimal = false,
  disabled = false,
  note,
  onLabelPress,
  labelHint,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  step: number;
  decimal?: boolean;
  disabled?: boolean;
  /** A short line under the label (e.g. "Per hand"). */
  note?: string;
  onLabelPress?: () => void;
  labelHint?: string;
}) {
  const c = useColors();
  const change = (delta: number) => {
    haptics.tick();
    onChange(stepValue(value, delta));
  };
  const heading = (
    <Row gap={4}>
      <Copy kind="label" tone="muted" style={{ flexShrink: 1 }}>{label}</Copy>
      {!!onLabelPress && <Ionicons name="chevron-down" size={16} color={c.muted} />}
    </Row>
  );
  return (
    <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs, padding: spacing.sm, borderRadius: radii.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      {onLabelPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} options`} accessibilityHint={labelHint} hitSlop={8}
          onPress={onLabelPress} style={({ pressed }) => ({ minHeight: 32, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          {heading}
        </Pressable>
      ) : <View style={{ minHeight: 32, justifyContent: "center" }}>{heading}</View>}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint="Type a value or use the minus and plus buttons"
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        placeholder="–"
        placeholderTextColor={c.muted}
        keyboardType={decimal ? "decimal-pad" : "number-pad"}
        returnKeyType="done"
        selectTextOnFocus
        style={[typography.numeric, {
          minHeight: 56, textAlign: "center", color: c.text, backgroundColor: c.sunken,
          borderRadius: radii.md, opacity: disabled ? 0.6 : 1,
        }]}
      />
      {!!note && <Copy kind="small" tone="muted" align="center" >{note}</Copy>}
      <Row justify="space-between">
        <IconButton icon="remove" label={`Decrease ${label}`} size={44}
          disabled={disabled || !((parseEntry(value) ?? 0) > 0)} onPress={() => change(-step)} />
        <IconButton icon="add" label={`Increase ${label}`} size={44} disabled={disabled} onPress={() => change(step)} />
      </Row>
    </View>
  );
}

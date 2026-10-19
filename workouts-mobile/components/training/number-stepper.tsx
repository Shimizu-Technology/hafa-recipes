import { TextInput, View } from "react-native";
import { radii, touch, typography } from "@/constants/theme";
import { stepValue } from "@/lib/training-view";
import { Button, Copy, IconButton, Row, haptics, useColors } from "@/components/ui";

/**
 * A big number with −/+ for one-handed logging. Tapping the number opens the keyboard
 * to type; "Clear" leaves it blank when the value is optional.
 */
export function NumberStepper({
  label,
  value,
  onChange,
  step,
  decimal = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  step: number;
  decimal?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  const change = (delta: number) => {
    haptics.tick();
    onChange(stepValue(value, delta));
  };
  return (
    <View style={{ gap: 8 }}>
      <Row justify="space-between">
        <Copy kind="label">{label}</Copy>
        {!!value.trim() && !disabled && (
          <Button title="Clear" variant="ghost" size="sm" inline accessibilityHint={`Leaves ${label} blank`} onPress={() => onChange("")} />
        )}
      </Row>
      <Row gap={12}>
        <IconButton icon="remove" label={`Decrease ${label}`} size={touch.comfortable}
          disabled={disabled || !(Number(value) > 0)} onPress={() => change(-step)} />
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
          maxFontSizeMultiplier={1.4}
          style={[typography.numeric, {
            flex: 1, minWidth: 0, minHeight: 64, textAlign: "center", color: c.text,
            backgroundColor: c.sunken, borderRadius: radii.md, opacity: disabled ? 0.6 : 1,
          }]}
        />
        <IconButton icon="add" label={`Increase ${label}`} size={touch.comfortable}
          disabled={disabled} onPress={() => change(step)} />
      </Row>
    </View>
  );
}

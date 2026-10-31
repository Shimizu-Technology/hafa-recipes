import { useState } from "react";
import { Pressable, TextInput, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radii, typography } from "@/constants/theme";
import { Copy, IconButton, useColors } from "@/components/ui";

/** Search without a visible label, plus the filter button with its active count. */
export function LibrarySearch({ value, onChange, filterCount, onFilters }: {
  value: string;
  onChange(value: string): void;
  filterCount: number;
  onFilters(): void;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{
        flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 14,
        borderRadius: radii.full, backgroundColor: c.elevated, borderWidth: focused ? 2 : 1,
        borderColor: focused ? c.focus : c.border,
      }}>
        <Ionicons name="search" size={18} color={c.muted} />
        <TextInput
          key={fontScale}
          allowFontScaling={false}
          accessibilityLabel="Search workouts"
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search workouts"
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          style={[typography.body, { flex: 1, color: c.text, fontSize: typography.body.fontSize * fontScale, lineHeight: typography.body.lineHeight * fontScale, paddingVertical: 10 }]}
        />
        {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={15} onPress={() => onChange("")}>
          <Ionicons name="close-circle" size={18} color={c.muted} />
        </Pressable>}
      </View>
      <View>
        <IconButton icon="options-outline" variant={filterCount ? "primary" : "soft"} onPress={onFilters}
          label={filterCount ? `Filters, ${filterCount} on` : "Filters"} />
        {!!filterCount && <View pointerEvents="none" style={{
          position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: radii.full,
          alignItems: "center", justifyContent: "center", backgroundColor: c.elevated, borderWidth: 1, borderColor: c.action,
        }}>
          <Copy kind="caption" tone="action" style={{ fontSize: 11, lineHeight: 14 }}>{filterCount}</Copy>
        </View>}
      </View>
    </View>
  );
}

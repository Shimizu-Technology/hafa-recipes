import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';

/** A JS-drawn two-or-three option switch for sibling views, identical on iOS and Android. */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  return <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={[styles.track, { backgroundColor: colors.surface2 }]}>
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={option.value} onPress={() => { if (!selected) onChange(option.value); }}
        accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={option.label} testID={`segment-${option.value}`}
        style={[styles.segment, selected && [styles.selected, { backgroundColor: colors.chromeSegment }]]}>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[styles.label, { color: colors.text }]}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', minHeight: 36, borderRadius: 10, padding: 2 },
  segment: { flex: 1, minHeight: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  selected: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3, elevation: 1 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
});

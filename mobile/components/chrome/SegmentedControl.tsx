import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';
import { MIN_TOUCH, touchInset } from '@/components/chrome/touch';

const TRACK_HEIGHT = 36;
export const SEGMENT_HEIGHT = 32;
const OVERHANG = touchInset(TRACK_HEIGHT);

/**
 * A JS-drawn two-or-three option switch for sibling views, identical on iOS and Android.
 * The 36pt track is drawn behind 44pt-tall segments, and the control pulls back by the overhang
 * so it still takes 36pt of layout.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  return <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.control}>
    <View pointerEvents="none" style={[styles.track, { backgroundColor: colors.surface2 }]} />
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={option.value} onPress={() => { if (!selected) onChange(option.value); }}
        accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={option.label} testID={`segment-${option.value}`}
        style={styles.target}>
        <View style={[styles.segment, selected && [styles.selected, { backgroundColor: colors.chromeSegment }]]}>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[styles.label, { color: colors.text }]}>{option.label}</Text>
        </View>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  control: { flexDirection: 'row', minHeight: MIN_TOUCH, marginVertical: -OVERHANG, paddingHorizontal: 2 },
  track: { position: 'absolute', left: 0, right: 0, top: OVERHANG, bottom: OVERHANG, borderRadius: 10 },
  target: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', paddingVertical: OVERHANG + 2 },
  segment: { minHeight: SEGMENT_HEIGHT, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  selected: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3, elevation: 1 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
});

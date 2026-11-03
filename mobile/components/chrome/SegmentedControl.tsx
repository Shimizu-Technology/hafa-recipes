import { useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';
import { useIndicatorX } from '@/components/chrome/motion';
import { MIN_TOUCH, touchInset } from '@/components/chrome/touch';

const TRACK_HEIGHT = 36;
export const SEGMENT_HEIGHT = 32;
const OVERHANG = touchInset(TRACK_HEIGHT);

/**
 * A JS-drawn two-or-three option switch for sibling views, identical on iOS and Android.
 * The 36pt track is drawn behind 44pt-tall segments, and the control pulls back by the overhang
 * so it still takes 36pt of layout. The selected sheet slides to the chosen option.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const segmentWidth = (width - 4) / options.length;
  const index = Math.max(0, options.findIndex(option => option.value === value));
  const x = useIndicatorX(width ? 2 + index * segmentWidth : 0, index);
  return <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.control}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View pointerEvents="none" style={[styles.track, { backgroundColor: colors.surface2 }]} />
    {width > 0 && <Animated.View pointerEvents="none" style={[styles.selected, { width: segmentWidth, backgroundColor: colors.chromeSegment, borderColor: colors.border, transform: [{ translateX: x }] }]} />}
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={option.value} onPress={() => { if (!selected) onChange(option.value); }}
        accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={option.label} testID={`segment-${option.value}`}
        style={styles.target}>
        <View style={styles.segment}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[styles.label, { color: selected ? colors.text : colors.textSecondary }]}>{option.label}</Text>
        </View>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  control: { flexDirection: 'row', minHeight: MIN_TOUCH, marginVertical: -OVERHANG, paddingHorizontal: 2 },
  track: { position: 'absolute', left: 0, right: 0, top: OVERHANG, bottom: OVERHANG, borderRadius: 10 },
  target: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', paddingVertical: OVERHANG + 2 },
  segment: { minHeight: SEGMENT_HEIGHT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  selected: { position: 'absolute', left: 0, top: OVERHANG + 2, bottom: OVERHANG + 2, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
});

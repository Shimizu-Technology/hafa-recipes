import { useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';
import { useIndicatorX } from '@/components/lookMotion';
import { useLook } from '@/contexts/LookContext';
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
  const look = useLook();
  if (look.variants.segmented !== 'current') return <LookSegmentedControl options={options} value={value} onChange={onChange} accessibilityLabel={accessibilityLabel} />;
  return <CurrentSegmentedControl options={options} value={value} onChange={onChange} accessibilityLabel={accessibilityLabel} />;
}

function CurrentSegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: {
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
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[styles.label, { color: colors.text }]}>{option.label}</Text>
        </View>
      </Pressable>;
    })}
  </View>;
}

/**
 * Preview looks: the selection slides. Cookbook draws editorial text tabs over a hairline with a 2pt ink
 * underline; Island and Calm keep a track with a sliding pill (Island sand and soft shadow, Calm hairline).
 */
function LookSegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  const look = useLook();
  const underline = look.variants.segmented === 'underline';
  const [width, setWidth] = useState(0);
  const segmentWidth = (width - 4) / options.length;
  const index = Math.max(0, options.findIndex(option => option.value === value));
  const x = useIndicatorX(width ? 2 + index * segmentWidth : 0);
  const slide = { transform: [{ translateX: x }] };
  const raised = look.variants.card === 'raised';
  const trackRadius = underline ? 0 : look.radii.field;
  return <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.control}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {underline
      ? <View pointerEvents="none" style={[styles.rule, { backgroundColor: colors.hairline }]} />
      : <View pointerEvents="none" style={[styles.track, { borderRadius: trackRadius, backgroundColor: raised ? colors.backgroundSecondary : colors.surface2 }]} />}
    {width > 0 && <Animated.View pointerEvents="none" style={[underline
      ? [styles.underline, { backgroundColor: colors.text }]
      : [styles.slider, { borderRadius: trackRadius - 2, backgroundColor: colors.chromeSegment },
        raised ? styles.sliderShadow : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }],
      { width: segmentWidth }, slide]} />}
    {options.map(option => {
      const selected = option.value === value;
      return <Pressable key={option.value} onPress={() => { if (!selected) { void import('@/utils/haptics').then(haptics => haptics.selectionHaptic()); onChange(option.value); } }}
        accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={option.label} testID={`segment-${option.value}`}
        style={styles.target}>
        <View style={styles.segment}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
            style={[styles.label, { color: selected || !underline ? colors.text : colors.textSecondary }]}>{option.label}</Text>
        </View>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  rule: { position: 'absolute', left: 0, right: 0, bottom: OVERHANG, height: StyleSheet.hairlineWidth },
  underline: { position: 'absolute', left: 0, bottom: OVERHANG, height: 2, borderRadius: 1 },
  slider: { position: 'absolute', left: 0, top: OVERHANG + 2, bottom: OVERHANG + 2 },
  sliderShadow: { shadowColor: '#2A2118', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.10, shadowRadius: 4, elevation: 1 },
  control: { flexDirection: 'row', minHeight: MIN_TOUCH, marginVertical: -OVERHANG, paddingHorizontal: 2 },
  track: { position: 'absolute', left: 0, right: 0, top: OVERHANG, bottom: OVERHANG, borderRadius: 10 },
  target: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', paddingVertical: OVERHANG + 2 },
  segment: { minHeight: SEGMENT_HEIGHT, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  selected: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3, elevation: 1 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
});

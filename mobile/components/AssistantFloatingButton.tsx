import { useEffect, useContext } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, TextScaleContext, useColors } from '@/components/Themed';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { ASK_PILL_HEIGHT } from '@/lib/bottomOverlay';
import { haptics } from '@/utils/haptics';
import { useLook } from '@/contexts/LookContext';

export { ASK_PILL_HEIGHT };
const LABEL_MAX_WIDTH = 200;

/**
 * The floating chat entry: an accent pill with a sparkle and a label ("Ask Håfa", or
 * "Ask about this" on a recipe). It folds to a 48pt circle while the list scrolls down.
 * The recipe screen mounts this too, so both entries look and behave the same.
 */
export function AskHafaPill({ label = 'Ask Håfa', onPress, collapsed = false, accessibilityHint = 'Opens the cooking assistant chat' }: {
  label?: string;
  onPress: () => void;
  collapsed?: boolean;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const look = useLook();
  const { fontScale } = useWindowDimensions();
  const scale = useContext(TextScaleContext);
  const compact = collapsed || fontScale * scale >= 1.5;
  const reduceMotion = useReduceMotion();
  const open = useSharedValue(compact ? 0 : 1);
  useEffect(() => {
    open.value = reduceMotion ? (compact ? 0 : 1) : withTiming(compact ? 0 : 1, { duration: 180 });
  }, [compact, open, reduceMotion]);
  const labelStyle = useAnimatedStyle(() => ({
    maxWidth: open.value * LABEL_MAX_WIDTH,
    marginLeft: open.value * 8,
    opacity: open.value,
  }));
  const pillStyle = useAnimatedStyle(() => ({ paddingRight: 13 + open.value * 5 }));
  // One accent object per region: Cookbook's pill is ink, Island's and Calm's are surface pills with an accent glyph.
  const variant = look.variants.askPill;
  const fill = variant === 'ink' ? colors.ink : variant === 'surface' ? colors.backgroundElevated : colors.tint;
  const labelColor = variant === 'ink' ? colors.onInk : variant === 'surface' ? colors.text : colors.onTint;
  const glyph = variant === 'ink' ? colors.onInkAccent : variant === 'surface' ? colors.actionText : colors.onTint;
  const surface = variant === 'accent' ? null : [look.shadows.float, variant === 'surface' && {
    borderWidth: look.variants.card === 'sheet' || colors.dark ? StyleSheet.hairlineWidth : 0, borderColor: colors.border }];

  return (
    <Pressable
      onPress={() => { haptics.medium(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      testID="ask-hafa-pill"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <Animated.View style={[styles.pill, { backgroundColor: fill }, pillStyle, surface]}>
        <Ionicons name="sparkles" size={22} color={glyph} />
        <Animated.View style={[styles.labelClip, labelStyle]}>
          <Text numberOfLines={1} style={[styles.label, { color: labelColor }]}>{label}</Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: ASK_PILL_HEIGHT,
    minWidth: ASK_PILL_HEIGHT,
    borderRadius: ASK_PILL_HEIGHT / 2,
    paddingLeft: 13,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  labelClip: { overflow: 'hidden' },
  label: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
});

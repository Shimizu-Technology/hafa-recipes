import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { ASK_PILL_HEIGHT } from '@/lib/bottomOverlay';
import { haptics } from '@/utils/haptics';

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
  const reduceMotion = useReduceMotion();
  const open = useSharedValue(collapsed ? 0 : 1);
  useEffect(() => {
    open.value = reduceMotion ? (collapsed ? 0 : 1) : withTiming(collapsed ? 0 : 1, { duration: 180 });
  }, [collapsed, open, reduceMotion]);
  const labelStyle = useAnimatedStyle(() => ({
    maxWidth: open.value * LABEL_MAX_WIDTH,
    marginLeft: open.value * 8,
    opacity: open.value,
  }));
  const pillStyle = useAnimatedStyle(() => ({ paddingRight: 13 + open.value * 5 }));

  return (
    <Pressable
      onPress={() => { haptics.medium(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      testID="ask-hafa-pill"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <Animated.View style={[styles.pill, { backgroundColor: colors.tint }, pillStyle]}>
        <Ionicons name="sparkles" size={22} color={colors.onTint} />
        <Animated.View style={[styles.labelClip, labelStyle]}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.label, { color: colors.onTint }]}>{label}</Text>
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

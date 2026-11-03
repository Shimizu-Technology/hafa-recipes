import { useEffect, useContext } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, TextScaleContext, useColors } from '@/components/Themed';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { ASK_PILL_HEIGHT } from '@/lib/bottomOverlay';
import { haptics } from '@/utils/haptics';

export { ASK_PILL_HEIGHT };
const LABEL_MAX_WIDTH = 200;

/**
 * The floating chat entry: a white pill with a hairline, a reef sparkle and a label ("Ask Håfa", or
 * "Ask about this" on a recipe). It folds to a 48pt circle while the list scrolls down.
 * The recipe screen mounts this too, so both entries look and behave the same. It stays neutral so
 * the reef Import and the screen's primary action remain the only accent fills.
 */
export function AskHafaPill({ label = 'Ask Håfa', onPress, collapsed = false, accessibilityHint = 'Opens the cooking assistant chat' }: {
  label?: string;
  onPress: () => void;
  collapsed?: boolean;
  accessibilityHint?: string;
}) {
  const colors = useColors();
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

  return (
    <Pressable
      onPress={() => { haptics.medium(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      testID="ask-hafa-pill"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <Animated.View style={[styles.pill, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, shadowColor: colors.dark ? '#000000' : colors.shadowColor }, pillStyle]}>
        <Ionicons name="sparkles" size={22} color={colors.actionText} />
        <Animated.View style={[styles.labelClip, labelStyle]}>
          <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>{label}</Text>
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
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  labelClip: { overflow: 'hidden' },
  label: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
});

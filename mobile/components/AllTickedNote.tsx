import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { lightHaptic } from '@/utils/haptics';

/**
 * Calm's one delight: when every ingredient is ticked, a quiet "Everything's ready" check fades in
 * (200ms, a 0.96 to 1 settle; Reduce Motion keeps the fade) with a single light haptic.
 */
export function AllTickedNote({ total, ticked }: { total: number; ticked: number }) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const done = total > 0 && ticked >= total;
  const shown = useRef(new Animated.Value(done ? 1 : 0)).current;
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) lightHaptic();
    wasDone.current = done;
    Animated.timing(shown, { toValue: done ? 1 : 0, duration: done ? 200 : 150, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }).start();
  }, [done, shown]);
  const style = {
    opacity: shown,
    transform: [{ scale: reduceMotion ? 1 : shown.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
  };
  return <Animated.View style={[styles.note, style]} pointerEvents="none" accessibilityElementsHidden={!done}
    importantForAccessibility={done ? 'auto' : 'no-hide-descendants'} accessibilityLiveRegion="polite">
    <Ionicons name="checkmark-circle" size={20} color={colors.actionText} />
    <Text style={[styles.label, { color: colors.textSecondary }]}>Everything’s ready</Text>
  </Animated.View>;
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32, marginTop: -8, marginBottom: 8 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
});

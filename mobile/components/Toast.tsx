/**
 * App-wide toast host. Mount once near the root; call `showToast` from
 * `@/lib/toast` anywhere to confirm an action without interrupting the user.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text } from '@/components/Themed';
import Colors, { fontFamily, fontSize, radius, shadows, spacing } from '@/constants/Colors';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { getToast, runToastAction, subscribeToast, type ToastState } from '@/lib/toast';

const ENTER_MS = 220;
const EXIT_MS = 160;
const OFFSET_Y = 12;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Clears the tab bar and the recipe cook dock so the toast never covers a primary action. */
const BOTTOM_CLEARANCE = 80;

// One dark surface in both appearances keeps the toast distinct from cream cards and photos.
const surface = Colors.dark;

export { showToast, hideToast } from '@/lib/toast';

export function ToastHost() {
  const toast = useSyncExternalStore(subscribeToast, getToast, getToast);
  const [shown, setShown] = useState<ToastState | null>(toast);
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (toast) {
      setShown(toast);
      progress.value = withTiming(1, { duration: ENTER_MS, easing: EASE_OUT });
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.message);
      return;
    }
    progress.value = withTiming(0, { duration: EXIT_MS, easing: EASE_OUT }, (finished) => {
      if (finished) runOnJS(setShown)(null);
    });
  }, [toast, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * OFFSET_Y }],
  }), [reduceMotion]);

  if (!shown) return null;
  const icon = shown.tone === 'success'
    ? { name: 'checkmark-circle' as const, color: surface.success }
    : shown.tone === 'error'
      ? { name: 'alert-circle' as const, color: surface.error }
      : null;

  return (
    <RNView pointerEvents="box-none" style={[styles.container, { bottom: insets.bottom + BOTTOM_CLEARANCE }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          { backgroundColor: surface.backgroundElevated, shadowColor: surface.shadowColor },
          { paddingRight: shown.actionLabel ? spacing.xs : spacing.md },
          animatedStyle,
        ]}
      >
        {icon && <Ionicons name={icon.name} size={20} color={icon.color} />}
        <Text style={[styles.message, { color: surface.text }]} numberOfLines={3}>
          {shown.message}
        </Text>
        {shown.actionLabel && (
          <TouchableOpacity
            style={styles.action}
            onPress={() => runToastAction(shown.id)}
            accessibilityRole="button"
            accessibilityLabel={shown.actionLabel}
            hitSlop={{ top: 4, bottom: 4 }}
          >
            <Text style={[styles.actionText, { color: surface.actionText }]}>{shown.actionLabel}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    width: '100%',
    maxWidth: 560,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    ...shadows.medium,
  },
  message: {
    flex: 1,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    fontFamily: fontFamily.medium,
    lineHeight: 20,
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
  },
});

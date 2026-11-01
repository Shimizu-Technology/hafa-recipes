/**
 * Floating Timer Overlay
 *
 * Shows the running cook timer when the user leaves cook mode. Tap to return to
 * cook mode. On tab screens it sits above the native tab bar (as the iOS 26 bottom
 * accessory, or a docked pill on older iOS); elsewhere it floats under the header.
 */

import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  withSequence,
  withRepeat,
  FadeIn,
} from 'react-native-reanimated';

import { Text, useColors } from '@/components/Themed';
import { formatTime, timerAccessibilityLabel, useCookTimerSummary } from '@/components/CookTimerAccessory';
import { useCookTimerRunning } from '@/contexts/TimerContext';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import {
  DOCKED_TIMER_HEIGHT,
  cookTimerPlacement,
  isTabRoute,
  overlayBottom,
  supportsTabBottomAccessory,
  useTabScreenBottomInset,
} from '@/lib/bottomOverlay';

export function FloatingTimerOverlay() {
  const summary = useCookTimerSummary();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const inTabs = isTabRoute(useSegments());
  const tabInset = useTabScreenBottomInset();
  const running = useCookTimerRunning();
  const placement = cookTimerPlacement({
    running: running && summary !== null,
    inTabs,
    supportsAccessory: supportsTabBottomAccessory,
  });

  // Animation for pulsing when timer is about to complete
  const pulseOpacity = useSharedValue(1);
  const isUrgent = summary?.isUrgent ?? false;

  // Pulse animation when urgent - MUST be before any returns
  React.useEffect(() => {
    if (isUrgent) {
      pulseOpacity.value = withRepeat(
        withSequence(
          withSpring(0.7, { damping: 15, stiffness: 150 }),
          withSpring(1, { damping: 15, stiffness: 150 })
        ),
        -1,
        true
      );
    } else {
      pulseOpacity.value = withSpring(1);
    }
  }, [isUrgent, pulseOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  // The iOS 26 tab bar shows the timer as its native bottom accessory instead.
  // Note: We avoid using exiting animations here due to a race condition bug
  // with React Native's New Architecture (Fabric) on Android that causes crashes
  // when views with exit animations are removed during navigation transitions
  if (!summary || placement === 'hidden' || placement === 'accessory') {
    return null;
  }
  const { primaryTimer, otherTimersCount, recipeTitle, resume } = summary;

  const foreground = isUrgent ? colors.onError : colors.onTint;

  // Docked just above the tab bar on tab screens; otherwise below the header.
  const position = placement === 'dock'
    ? { bottom: overlayBottom({ inTabs, tabInset, windowInset: insets.bottom, clearance: 72 }) }
    : { top: insets.top + 50 };

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      pointerEvents="box-none"
      style={[
        styles.container,
        position,
      ]}
    >
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={[
            styles.banner,
            {
              backgroundColor: isUrgent ? colors.error : colors.tint,
            },
          ]}
          onPress={resume}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={timerAccessibilityLabel(summary)}
          accessibilityHint="Returns to cook mode"
        >
          <Ionicons
            name={primaryTimer.isPaused ? 'pause-circle' : 'timer-outline'}
            size={18}
            color={foreground}
          />

          <Text style={[styles.timerText, { color: foreground }]}>
            {formatTime(primaryTimer.remaining)}
          </Text>

          {primaryTimer.isPaused && (
            <Text style={[styles.statusText, { color: foreground }]}>paused</Text>
          )}

          {otherTimersCount > 0 && (
            <Text style={[styles.statusText, { color: foreground }]}>+{otherTimersCount}</Text>
          )}

          <RNView style={[styles.separator, { backgroundColor: foreground, opacity: 0.3 }]} />

          <Text style={[styles.recipeTitle, { color: foreground }]} numberOfLines={1}>
            {recipeTitle}
          </Text>

          <Ionicons
            name="chevron-forward"
            size={16}
            color={foreground}
          />
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: DOCKED_TIMER_HEIGHT,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  timerText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  statusText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  separator: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: spacing.xs,
  },
  recipeTitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    // The pill sizes to its content, so `flex: 1` collapsed the title to zero width.
    flexShrink: 1,
    maxWidth: 150,
  },
});

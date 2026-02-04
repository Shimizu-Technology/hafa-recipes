/**
 * Floating Timer Overlay
 * 
 * Shows a compact timer banner at the top of the screen when user leaves 
 * cook mode with active timers. Tap to return to cook mode.
 */

import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import { useRouter } from 'expo-router';
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
import { useTimerContext } from '@/contexts/TimerContext';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { lightHaptic } from '@/utils/haptics';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function FloatingTimerOverlay() {
  const { timers, session, isInCookMode, hasActiveTimers } = useTimerContext();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  // Animation for pulsing when timer is about to complete
  const pulseOpacity = useSharedValue(1);
  
  // Get the most urgent timer (lowest remaining time)
  const sortedTimers = React.useMemo(() => {
    return Array.from(timers.entries())
      .filter(([_, timer]) => timer.remaining > 0)
      .sort((a, b) => a[1].remaining - b[1].remaining);
  }, [timers]);
  
  const primaryTimer = sortedTimers[0]?.[1];
  const otherTimersCount = Math.max(0, sortedTimers.length - 1);
  const isUrgent = primaryTimer ? primaryTimer.remaining <= 30 && !primaryTimer.isPaused : false;
  
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
  
  // Don't show if in cook mode, no active timers, or no session
  // Note: We avoid using exiting animations here due to a race condition bug
  // with React Native's New Architecture (Fabric) on Android that causes crashes
  // when views with exit animations are removed during navigation transitions
  if (isInCookMode || !hasActiveTimers || !session || sortedTimers.length === 0) {
    return null;
  }
  
  const handlePress = () => {
    lightHaptic();
    
    // Push recipe detail first, then cook mode
    // Stack becomes: [current] → Recipe Detail → Cook Mode
    // When leaving cook mode, user lands on Recipe Detail (with back button to previous screen)
    router.push({
      pathname: '/recipe/[id]',
      params: { id: session.recipeId },
    });
    
    // Small delay to let the push complete, then push cook mode on top
    setTimeout(() => {
      router.push({
        pathname: '/cook-mode/[id]',
        params: {
          id: session.recipeId,
          ...(session.scaleFactor !== undefined && { scaleFactor: session.scaleFactor.toString() }),
          ...(session.servings !== undefined && { servings: session.servings.toString() }),
        },
      });
    }, 100);
  };
  
  // Position below typical header height (safe area + ~50px for header)
  const topPosition = insets.top + 50;
  
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[
        styles.container,
        { top: topPosition },
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
          onPress={handlePress}
          activeOpacity={0.8}
        >
          <Ionicons
            name={primaryTimer.isPaused ? 'pause-circle' : 'timer-outline'}
            size={18}
            color="#FFFFFF"
          />
          
          <Text style={styles.timerText}>
            {formatTime(primaryTimer.remaining)}
          </Text>
          
          {primaryTimer.isPaused && (
            <Text style={styles.statusText}>paused</Text>
          )}
          
          {otherTimersCount > 0 && (
            <Text style={styles.statusText}>+{otherTimersCount}</Text>
          )}
          
          <RNView style={styles.separator} />
          
          <Text style={styles.recipeTitle} numberOfLines={1}>
            {session.recipeTitle}
          </Text>
          
          <Ionicons 
            name="chevron-forward" 
            size={16} 
            color="rgba(255,255,255,0.8)" 
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
    color: '#FFFFFF',
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
    flex: 1,
    maxWidth: 150,
  },
});

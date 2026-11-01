/**
 * The running cook timer as the iOS 26 tab bar's native bottom accessory, plus the
 * timer summary shared with the floating overlay used everywhere else.
 */

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { useCookTimerRunning, useTimerContext } from '@/contexts/TimerContext';
import { spacing, typography } from '@/constants/Colors';
import { supportsTabBottomAccessory } from '@/lib/bottomOverlay';
import { lightHaptic } from '@/utils/haptics';

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** The most urgent running timer and a way back to cook mode, or null when none runs. */
export function useCookTimerSummary() {
  const { timers, session, isInCookMode, hasActiveTimers } = useTimerContext();
  const router = useRouter();

  // Get the most urgent timer (lowest remaining time)
  const sortedTimers = React.useMemo(() => {
    return Array.from(timers.entries())
      .filter(([_, timer]) => timer.remaining > 0)
      .sort((a, b) => a[1].remaining - b[1].remaining);
  }, [timers]);

  const primaryTimer = sortedTimers[0]?.[1];
  if (isInCookMode || !hasActiveTimers || !session || !primaryTimer) return null;

  const resume = () => {
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

  return {
    primaryTimer,
    otherTimersCount: Math.max(0, sortedTimers.length - 1),
    isUrgent: primaryTimer.remaining <= 30 && !primaryTimer.isPaused,
    recipeTitle: session.recipeTitle,
    resume,
  };
}

export function timerAccessibilityLabel(summary: NonNullable<ReturnType<typeof useCookTimerSummary>>) {
  const { primaryTimer, otherTimersCount, recipeTitle } = summary;
  return [
    `Cook timer ${formatTime(primaryTimer.remaining)}${primaryTimer.isPaused ? ', paused' : ''}`,
    otherTimersCount > 0 ? `${otherTimersCount} more` : null,
    recipeTitle,
  ].filter(Boolean).join(', ');
}

/** Running cook timer inside the iOS 26 tab bar's native bottom accessory. */
export function CookTimerAccessory() {
  const summary = useCookTimerSummary();
  const colors = useColors();
  const inline = NativeTabs.BottomAccessory.usePlacement() === 'inline';
  if (!summary) return null;
  const { primaryTimer, otherTimersCount, isUrgent, recipeTitle, resume } = summary;
  const tone = isUrgent ? colors.error : colors.actionText;
  return (
    <Pressable
      onPress={resume}
      accessibilityRole="button"
      accessibilityLabel={timerAccessibilityLabel(summary)}
      accessibilityHint="Returns to cook mode"
      style={({ pressed }) => [styles.accessory, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={primaryTimer.isPaused ? 'pause-circle' : 'timer-outline'} size={20} color={tone} />
      <Text style={[styles.accessoryTime, { color: tone }]}>{formatTime(primaryTimer.remaining)}</Text>
      <Text style={[styles.accessoryTitle, { color: colors.text }]} numberOfLines={1}>
        {primaryTimer.isPaused ? 'Paused · ' : ''}{otherTimersCount > 0 && !inline ? `+${otherTimersCount} · ` : ''}{recipeTitle}
      </Text>
      {!inline && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
    </Pressable>
  );
}

/** The accessory element for the tab layout, or null while no timer runs. */
export function useCookTimerAccessory() {
  const running = useCookTimerRunning();
  return React.useMemo(() => supportsTabBottomAccessory && running
    ? <NativeTabs.BottomAccessory><CookTimerAccessory /></NativeTabs.BottomAccessory>
    : null, [running]);
}

const styles = StyleSheet.create({
  accessory: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  accessoryTime: {
    ...typography.headline,
    fontVariant: ['tabular-nums'],
  },
  accessoryTitle: {
    ...typography.subhead,
    flex: 1,
  },
});

/** The running cook timer's summary and resume action, shared by the floating timer overlay. */

import React from 'react';
import { useRouter } from 'expo-router';

import { useTimerContext } from '@/contexts/TimerContext';
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

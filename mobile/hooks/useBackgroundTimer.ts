import { recipeScope } from '@/lib/recipeQueryScope';
import { offlineRecipes } from '@/lib/offlineRecipes';
/**
 * Hook for background timer notifications.
 * 
 * When a timer is running and the app goes to background, this schedules
 * a local notification for when the timer completes.
 */

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { TimerSoundOption } from './useTimerSound';

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Track scheduled notification IDs per step
interface ScheduledNotification {
  stepIndex: number;
  notificationId: string;
  endTime: number; // Unix timestamp when timer ends
}

// Scheduled notification IDs live at module scope, keyed by scope (the recipe
// in cook mode), so leaving and re-entering cook mode — which remounts the
// screen while its timers keep running — can still pause, cancel, and
// recognize notifications that were scheduled before the remount.
type AlertAttempt = { endTime: number; stepText: string; sound: TimerSoundOption };
const attempts = new Map<string, Map<number, AlertAttempt>>();

const scheduledByScope = new Map<string, Map<number, ScheduledNotification>>();

function scheduledFor(scope: string): Map<number, ScheduledNotification> {
  let scheduled = scheduledByScope.get(scope);
  if (!scheduled) {
    scheduled = new Map();
    scheduledByScope.set(scope, scheduled);
  }
  return scheduled;
}

type AlertStatus = 'scheduling' | 'scheduled' | 'off';
const alerts = new Map<string, Map<number, AlertStatus>>();
const generations = new Map<string, Map<number, number>>();
const versions = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
function statusFor(scope: string) {
  if (!alerts.has(scope)) alerts.set(scope, new Map());
  return alerts.get(scope)!;
}
function setStatus(scope: string, step: number, status?: AlertStatus) {
  if (status) statusFor(scope).set(step, status); else statusFor(scope).delete(step);
  versions.set(scope, (versions.get(scope) || 0) + 1);
  listeners.get(scope)?.forEach(listener => listener());
}
function advance(scope: string, step: number) {
  if (!generations.has(scope)) generations.set(scope, new Map());
  const next = (generations.get(scope)!.get(step) || 0) + 1;
  generations.get(scope)!.set(step, next);
  return next;
}
async function cancelExisting(scope: string, step: number) {
  const scheduled = scheduledFor(scope).get(step);
  if (!scheduled) return;
  await Notifications.cancelScheduledNotificationAsync(scheduled.notificationId);
  if (scheduledFor(scope).get(step) === scheduled) scheduledFor(scope).delete(step);
}

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  const { granted: alreadyGranted } = await Notifications.getPermissionsAsync();
  
  if (alreadyGranted) {
    return true;
  }
  
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

/**
 * Hook to manage background timer notifications
 */
// Timer alerts can outlive the route. Retire their private text even when
// Cook Mode is no longer mounted, and invalidate pending scheduling attempts.
offlineRecipes.onRetire(() => {
  for (const [scope, steps] of generations) for (const step of steps.keys()) advance(scope, step);
  for (const scheduled of scheduledByScope.values()) for (const item of scheduled.values()) {
    void Notifications.cancelScheduledNotificationAsync(item.notificationId).catch(() => undefined);
  }
  attempts.clear(); scheduledByScope.clear(); alerts.clear();
  for (const scope of listeners.keys()) {
    versions.set(scope, (versions.get(scope) || 0) + 1);
    listeners.get(scope)?.forEach(listener => listener());
  }
});

export function useBackgroundTimer(scope = 'default') {
  const ownerScope = recipeScope();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const scheduledNotifications = useRef({
    get current() {
      return scheduledFor(scopeRef.current);
    },
  }).current;
  const appState = useRef<AppStateStatus>(AppState.currentState);
  
  useSyncExternalStore(
    useCallback((listener: () => void) => {
      if (!listeners.has(scope)) listeners.set(scope, new Set());
      listeners.get(scope)!.add(listener);
      return () => { listeners.get(scope)?.delete(listener); };
    }, [scope]),
    useCallback(() => versions.get(scope) || 0, [scope]),
  );

  // Re-check after returning from Settings; denial must never stop the clock.
  useEffect(() => {
    let mounted = true;
    const check = () => Notifications.getPermissionsAsync()
      .then(({ granted }) => { if (mounted) setHasPermission(granted); })
      .catch(() => { if (mounted) setHasPermission(false); });
    void check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  const scheduleTimerNotification = useCallback(async (
    stepIndex: number,
    remainingSeconds: number,
    stepText: string,
    soundPreference: TimerSoundOption = 'default',
    deadline?: number,
  ): Promise<string | null> => {
    if (ownerScope !== recipeScope()) return null;
    const activeScope = scopeRef.current;
    const generation = advance(activeScope, stepIndex);
    const isCurrent = () => generations.get(activeScope)?.get(stepIndex) === generation;
    const endTime = deadline ?? Date.now() + remainingSeconds * 1000;
    if (!attempts.has(activeScope)) attempts.set(activeScope, new Map());
    attempts.get(activeScope)!.set(stepIndex, { endTime, stepText, sound: soundPreference });
    setStatus(activeScope, stepIndex, 'scheduling');
    try {
      await cancelExisting(activeScope, stepIndex);
      if (!isCurrent()) return null;
      if (remainingSeconds <= 0) { setStatus(activeScope, stepIndex); return null; }
      const granted = await requestNotificationPermissions();
      if (!isCurrent()) return null;
      if (scopeRef.current === activeScope) setHasPermission(granted);
      if (!granted) { setStatus(activeScope, stepIndex, 'off'); return null; }
      const seconds = Math.ceil((endTime - Date.now()) / 1000);
      if (seconds <= 0) { setStatus(activeScope, stepIndex); return null; }
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Timer complete!',
          body: stepText.length > 100 ? stepText.substring(0, 97) + '...' : stepText,
          sound: soundPreference !== 'none' ? getSoundFileName(soundPreference) : undefined,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          vibrate: [0, 500, 200, 500],
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
      });
      // A stop/pause/restart while permission or scheduling was pending wins.
      if (!isCurrent()) {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
        return null;
      }
      scheduledFor(activeScope).set(stepIndex, { stepIndex, notificationId, endTime });
      setStatus(activeScope, stepIndex, 'scheduled');
      return notificationId;
    } catch (error) {
      if (isCurrent()) setStatus(activeScope, stepIndex, 'off');
      console.error('Failed to schedule timer alert:', error);
      return null;
    }
  }, [ownerScope]);

  const retryFailedAlerts = useCallback(async () => {
    const activeScope = scopeRef.current;
    await Promise.all([...statusFor(activeScope)].filter(([, status]) => status === 'off').map(([step]) => {
      const attempt = attempts.get(activeScope)?.get(step);
      if (!attempt) return;
      return scheduleTimerNotification(step, Math.max(0, (attempt.endTime - Date.now()) / 1000), attempt.stepText, attempt.sound, attempt.endTime);
    }));
  }, [scheduleTimerNotification]);

  const cancelTimerNotification = useCallback(async (stepIndex: number) => {
    const activeScope = scopeRef.current;
    advance(activeScope, stepIndex);
    attempts.get(activeScope)?.delete(stepIndex);
    setStatus(activeScope, stepIndex);
    try { await cancelExisting(activeScope, stepIndex); }
    catch (error) { console.error('Failed to cancel notification:', error); }
  }, []);

  /**
   * Cancel all scheduled timer notifications
   */
  const cancelAllTimerNotifications = useCallback(async () => {
    const steps = new Set([...scheduledNotifications.current.keys(), ...statusFor(scopeRef.current).keys()]);
    await Promise.all([...steps].map(cancelTimerNotification));
  }, [cancelTimerNotification]);

  /**
   * Get remaining time for a step from its scheduled notification
   * Useful when app comes back from background
   */
  const getRemainingTime = useCallback((stepIndex: number): number | null => {
    if (statusFor(scopeRef.current).get(stepIndex) !== 'scheduled') return null;
    const scheduled = scheduledNotifications.current.get(stepIndex);
    if (!scheduled) return null;
    
    const remaining = Math.max(0, Math.floor((scheduled.endTime - Date.now()) / 1000));
    return remaining;
  }, []);

  /**
   * Check if a step has a scheduled notification
   */
  const hasScheduledNotification = useCallback((stepIndex: number): boolean => {
    return statusFor(scopeRef.current).get(stepIndex) === 'scheduled'
      && scheduledNotifications.current.has(stepIndex);
  }, []);

  /**
   * Update notification when timer is paused
   * (cancels the notification since timer is paused)
   */
  const pauseTimerNotification = useCallback(async (stepIndex: number) => {
    await cancelTimerNotification(stepIndex);
  }, [cancelTimerNotification]);

  /**
   * Resume notification after timer is unpaused
   */
  const resumeTimerNotification = useCallback(async (
    stepIndex: number,
    remainingSeconds: number,
    stepText: string,
    soundPreference: TimerSoundOption = 'default'
  ) => {
    return scheduleTimerNotification(stepIndex, remainingSeconds, stepText, soundPreference);
  }, [scheduleTimerNotification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't cancel notifications on unmount - let them fire even if user leaves cook mode
      // User explicitly starting a timer means they want to be notified
    };
  }, []);

  return {
    hasPermission,
    retryFailedAlerts,
    alertStatus: (stepIndex: number) => statusFor(scope).get(stepIndex),
    hasAlertFailure: [...statusFor(scope).values()].includes('off'),
    scheduleTimerNotification,
    cancelTimerNotification,
    cancelAllTimerNotifications,
    pauseTimerNotification,
    resumeTimerNotification,
    getRemainingTime,
    hasScheduledNotification,
    requestNotificationPermissions,
  };
}

/**
 * Hook to handle app state changes and sync timers
 */
export function useAppStateSync(
  onBackgrounded: () => void,
  onForegrounded: () => void
) {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to foreground
        if (__DEV__) console.log('App foregrounded');
        onForegrounded();
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App is going to background
        if (__DEV__) console.log('App backgrounded');
        onBackgrounded();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [onBackgrounded, onForegrounded]);
}

/**
 * Get the sound file name for notifications
 */
function getSoundFileName(preference: TimerSoundOption): string | undefined {
  switch (preference) {
    case 'default':
      return 'timer_complete.mp3';
    case 'bell':
      return 'timer_bell.mp3';
    case 'chime':
      return 'timer_chime.mp3';
    case 'alarm':
      return 'timer_alarm.mp3';
    case 'none':
      return undefined;
    default:
      return 'timer_complete.mp3';
  }
}

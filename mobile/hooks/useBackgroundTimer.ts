/**
 * Hook for background timer notifications.
 * 
 * When a timer is running and the app goes to background, this schedules
 * a local notification for when the timer completes.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getTimerSoundFile, TimerSoundOption } from './useTimerSound';

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

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  
  if (existingStatus === 'granted') {
    return true;
  }
  
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Hook to manage background timer notifications
 */
export function useBackgroundTimer() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const scheduledNotifications = useRef<Map<number, ScheduledNotification>>(new Map());
  const appState = useRef<AppStateStatus>(AppState.currentState);
  
  // Check permissions on mount
  useEffect(() => {
    const checkPermissions = async () => {
      const { status } = await Notifications.getPermissionsAsync();
      setHasPermission(status === 'granted');
    };
    checkPermissions();
  }, []);

  /**
   * Schedule a notification for when timer completes
   */
  const scheduleTimerNotification = useCallback(async (
    stepIndex: number,
    remainingSeconds: number,
    stepText: string,
    soundPreference: TimerSoundOption = 'default'
  ): Promise<string | null> => {
    // Cancel any existing notification for this step
    await cancelTimerNotification(stepIndex);
    
    // Don't schedule if timer is already done
    if (remainingSeconds <= 0) return null;
    
    // Check permissions
    const granted = await requestNotificationPermissions();
    if (!granted) {
      console.log('⚠️ Notification permission not granted');
      setHasPermission(false);
      return null;
    }
    setHasPermission(true);
    
    const endTime = Date.now() + (remainingSeconds * 1000);
    
    // Truncate step text for notification body
    const truncatedStep = stepText.length > 100 
      ? stepText.substring(0, 97) + '...' 
      : stepText;
    
    try {
      // Schedule the notification
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: '⏰ Timer Complete!',
          body: truncatedStep,
          sound: soundPreference !== 'none' ? getSoundFileName(soundPreference) : undefined,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          vibrate: [0, 500, 200, 500],
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: remainingSeconds,
        },
      });
      
      // Track the scheduled notification
      scheduledNotifications.current.set(stepIndex, {
        stepIndex,
        notificationId,
        endTime,
      });
      
      console.log(`📅 Scheduled notification for step ${stepIndex} in ${remainingSeconds}s`);
      return notificationId;
    } catch (error) {
      console.error('Failed to schedule notification:', error);
      return null;
    }
  }, []);

  /**
   * Cancel a scheduled notification for a step
   */
  const cancelTimerNotification = useCallback(async (stepIndex: number) => {
    const scheduled = scheduledNotifications.current.get(stepIndex);
    if (scheduled) {
      try {
        await Notifications.cancelScheduledNotificationAsync(scheduled.notificationId);
        scheduledNotifications.current.delete(stepIndex);
        console.log(`🚫 Cancelled notification for step ${stepIndex}`);
      } catch (error) {
        console.error('Failed to cancel notification:', error);
      }
    }
  }, []);

  /**
   * Cancel all scheduled timer notifications
   */
  const cancelAllTimerNotifications = useCallback(async () => {
    const promises: Promise<void>[] = [];
    scheduledNotifications.current.forEach((scheduled) => {
      promises.push(
        Notifications.cancelScheduledNotificationAsync(scheduled.notificationId)
      );
    });
    await Promise.all(promises);
    scheduledNotifications.current.clear();
    console.log('🚫 Cancelled all timer notifications');
  }, []);

  /**
   * Get remaining time for a step from its scheduled notification
   * Useful when app comes back from background
   */
  const getRemainingTime = useCallback((stepIndex: number): number | null => {
    const scheduled = scheduledNotifications.current.get(stepIndex);
    if (!scheduled) return null;
    
    const remaining = Math.max(0, Math.floor((scheduled.endTime - Date.now()) / 1000));
    return remaining;
  }, []);

  /**
   * Check if a step has a scheduled notification
   */
  const hasScheduledNotification = useCallback((stepIndex: number): boolean => {
    return scheduledNotifications.current.has(stepIndex);
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
        console.log('📱 App foregrounded');
        onForegrounded();
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App is going to background
        console.log('📱 App backgrounded');
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

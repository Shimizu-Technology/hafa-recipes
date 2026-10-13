import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

const notifications = vi.hoisted(() => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: vi.fn().mockResolvedValue('notification-1'),
  cancelScheduledNotificationAsync: vi.fn().mockResolvedValue(undefined),
  AndroidNotificationPriority: { HIGH: 'high' },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
vi.mock('expo-notifications', () => notifications);
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) },
  Platform: { OS: 'ios' },
}));
vi.mock('./useTimerSound', () => ({ getTimerSoundFile: vi.fn() }));
vi.stubGlobal('__DEV__', false);

import { useBackgroundTimer } from './useBackgroundTimer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let timer!: ReturnType<typeof useBackgroundTimer>;
function Harness({ scope }: { scope: string }) {
  timer = useBackgroundTimer(scope);
  return null;
}

describe('useBackgroundTimer', () => {
  it('keeps scheduled notifications across a cook mode remount, scoped per recipe', async () => {
    const first = createRoot();
    await act(async () => first.render(<Harness scope="cook-mode:a" />));
    await act(async () => { await timer.scheduleTimerNotification(1, 60, 'Simmer'); });
    await act(async () => first.unmount());

    const second = createRoot();
    try {
      await act(async () => second.render(<Harness scope="cook-mode:b" />));
      expect(timer.hasScheduledNotification(1)).toBe(false);
      await act(async () => second.render(<Harness scope="cook-mode:a" />));
      expect(timer.hasScheduledNotification(1)).toBe(true);
      await act(async () => { await timer.cancelTimerNotification(1); });
      expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
      expect(timer.hasScheduledNotification(1)).toBe(false);
    } finally {
      await act(async () => second.unmount());
    }
  });
});

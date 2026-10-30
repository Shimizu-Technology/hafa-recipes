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

it('reports denied permission without inventing a scheduled alert', async () => {
  notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false }).mockResolvedValueOnce({ granted: false });
  notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
  const r = createRoot();
  await act(async () => r.render(<Harness scope="denied" />));
  await act(async () => { expect(await timer.scheduleTimerNotification(2, 60, 'Simmer')).toBeNull(); });
  expect(timer.hasPermission).toBe(false);
  expect(timer.hasScheduledNotification(2)).toBe(false);
  expect(timer.alertStatus(2)).toBe('off');
  expect(timer.hasAlertFailure).toBe(true);
  await act(async () => r.unmount());
});

it('reports scheduling and permission lookup failures as unavailable alerts', async () => {
  notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
  notifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error('scheduler unavailable'));
  const r = createRoot();
  await act(async () => r.render(<Harness scope="failed" />));
  await act(async () => { expect(await timer.scheduleTimerNotification(1, 60, 'Simmer')).toBeNull(); });
  expect(timer.hasPermission).toBe(true); expect(timer.alertStatus(1)).toBe('off');
  expect(timer.hasScheduledNotification(1)).toBe(false);
  notifications.getPermissionsAsync.mockRejectedValueOnce(new Error('permission lookup failed'));
  await act(async () => { expect(await timer.scheduleTimerNotification(2, 60, 'Boil')).toBeNull(); });
  expect(timer.alertStatus(2)).toBe('off');
  await act(async () => r.unmount());
});

it('cancels the returned alert when Stop wins a pending scheduling race', async () => {
  let resolve!: (id: string) => void;
  notifications.scheduleNotificationAsync.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  const r = createRoot();
  await act(async () => r.render(<Harness scope="stop-pending" />));
  let pending!: Promise<string | null>;
  await act(async () => { pending = timer.scheduleTimerNotification(1, 60, 'Simmer'); });
  expect(timer.alertStatus(1)).toBe('scheduling');
  await act(async () => { await timer.cancelTimerNotification(1); resolve('late-alert'); await pending; });
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('late-alert');
  expect(timer.hasScheduledNotification(1)).toBe(false);
  expect(timer.alertStatus(1)).toBeUndefined();
  await act(async () => r.unmount());
});

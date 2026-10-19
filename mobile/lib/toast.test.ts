import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getToast,
  hideToast,
  runToastAction,
  setToastScreenReaderEnabled,
  showToast,
  subscribeToast,
  toastAnnouncement,
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
} from './toast';

describe('toast state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hideToast();
  });

  afterEach(() => {
    hideToast();
    setToastScreenReaderEnabled(false);
    vi.useRealTimers();
  });

  it('shows a neutral toast and dismisses it automatically', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToast(listener);
    showToast({ message: 'Note saved' });

    expect(getToast()).toMatchObject({ message: 'Note saved', tone: 'neutral', duration: TOAST_DURATION_MS });
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(getToast()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(getToast()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('replaces the visible toast and restarts the timer', () => {
    const first = showToast({ message: 'First' });
    vi.advanceTimersByTime(TOAST_DURATION_MS - 500);
    const second = showToast({ message: 'Second', tone: 'success' });

    expect(second).not.toBe(first);
    expect(getToast()).toMatchObject({ id: second, message: 'Second', tone: 'success' });

    // The first toast's timer must not dismiss its replacement.
    vi.advanceTimersByTime(500);
    expect(getToast()?.id).toBe(second);
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(getToast()).toBeNull();
  });

  it('ignores a stale hide for a toast that was already replaced', () => {
    const first = showToast({ message: 'First' });
    const second = showToast({ message: 'Second' });
    hideToast(first);
    expect(getToast()?.id).toBe(second);
  });

  it('keeps action toasts up longer and runs the action once', () => {
    const onAction = vi.fn();
    const id = showToast({ message: '3 added to your grocery list', actionLabel: 'View list', onAction });
    expect(getToast()?.duration).toBe(TOAST_ACTION_DURATION_MS);

    runToastAction(id);
    runToastAction(id);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(getToast()).toBeNull();
  });

  it('drops an action label that has no handler', () => {
    showToast({ message: 'Saved', actionLabel: 'Undo' });
    expect(getToast()?.actionLabel).toBeUndefined();
    expect(getToast()?.duration).toBe(TOAST_DURATION_MS);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToast(listener);
    unsubscribe();
    showToast({ message: 'Hidden' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps action toasts until dismissed while a screen reader is on', () => {
    setToastScreenReaderEnabled(true);
    const id = showToast({ message: '3 added to your pantry', actionLabel: 'Open pantry', onAction: vi.fn() });
    expect(getToast()?.persistent).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(getToast()?.id).toBe(id);
    hideToast(id);
    expect(getToast()).toBeNull();
  });

  it('still auto-dismisses plain toasts while a screen reader is on', () => {
    setToastScreenReaderEnabled(true);
    showToast({ message: 'Recipe updated' });
    expect(getToast()?.persistent).toBe(false);
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(getToast()).toBeNull();
  });

  it('lets a replacement end a persistent toast', () => {
    setToastScreenReaderEnabled(true);
    showToast({ message: 'First', actionLabel: 'View list', onAction: vi.fn() });
    const second = showToast({ message: 'Second' });
    expect(getToast()?.id).toBe(second);
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(getToast()).toBeNull();
  });

  it('follows screen reader changes for the visible action toast', () => {
    const id = showToast({ message: '3 added', actionLabel: 'View list', onAction: vi.fn() });
    setToastScreenReaderEnabled(true);
    vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS * 2);
    expect(getToast()?.id).toBe(id);
    setToastScreenReaderEnabled(false);
    vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS);
    expect(getToast()).toBeNull();
  });

  it('announces the action alongside the message', () => {
    expect(toastAnnouncement({ message: '3 added to your pantry', actionLabel: 'Open pantry' }))
      .toBe('3 added to your pantry. Open pantry button available');
    expect(toastAnnouncement({ message: 'Recipe updated.' })).toBe('Recipe updated.');
  });
});

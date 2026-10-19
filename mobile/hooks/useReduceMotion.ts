import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Live Reduce Motion setting shared by every caller through one native
 * listener, so list rows and skeletons can read it without extra subscriptions.
 */
let reduceMotion = false;
let subscription: { remove: () => void } | null = null;
const listeners = new Set<() => void>();

let eventCount = 0;

function update(value: boolean) {
  if (value === reduceMotion) return;
  reduceMotion = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscription) {
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      eventCount += 1;
      update(value);
    });
    // A change event that lands first is newer than this initial query.
    const eventsBeforeQuery = eventCount;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (eventCount === eventsBeforeQuery) update(value); })
      .catch(() => {});
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
    }
  };
}

const getSnapshot = () => reduceMotion;

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

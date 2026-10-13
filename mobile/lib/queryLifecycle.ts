/**
 * Connect React Query to native app focus and connectivity.
 *
 * React Query's defaults listen for browser `visibilitychange` and
 * `online`/`offline` events, which never fire in React Native. Without this,
 * `refetchOnWindowFocus` and `refetchOnReconnect` are silently inert on iOS
 * and Android.
 */

import { AppState, Platform, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';

/** Treat unknown connectivity as online so a cold start never blocks on NetInfo. */
export function isNetInfoOnline(state: Pick<NetInfoState, 'isConnected'>): boolean {
  return state.isConnected !== false;
}

export function isAppStateFocused(status: AppStateStatus): boolean {
  return status === 'active';
}

let bound = false;

export function bindReactQueryToNativeLifecycle(): void {
  if (bound || Platform.OS === 'web') return;
  bound = true;

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(isNetInfoOnline(state))),
  );

  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (status) => {
      handleFocus(isAppStateFocused(status));
    });
    return () => subscription.remove();
  });
}

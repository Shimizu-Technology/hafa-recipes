import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => {
  const appStateListeners: ((status: string) => void)[] = [];
  const netInfoListeners: ((state: { isConnected: boolean | null }) => void)[] = [];
  return {
    appStateListeners,
    netInfoListeners,
    removeAppState: vi.fn(),
    unsubscribeNetInfo: vi.fn(),
  };
});

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    addEventListener: (_: string, listener: (status: string) => void) => {
      native.appStateListeners.push(listener);
      return { remove: native.removeAppState };
    },
  },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: (listener: (state: { isConnected: boolean | null }) => void) => {
      native.netInfoListeners.push(listener);
      return native.unsubscribeNetInfo;
    },
  },
}));

import { focusManager, onlineManager } from '@tanstack/react-query';
import { bindReactQueryToNativeLifecycle, isNetInfoOnline } from './queryLifecycle';

describe('React Query native lifecycle', () => {
  it('treats unknown connectivity as online', () => {
    expect(isNetInfoOnline({ isConnected: null })).toBe(true);
    expect(isNetInfoOnline({ isConnected: true })).toBe(true);
    expect(isNetInfoOnline({ isConnected: false })).toBe(false);
  });

  it('drives focusManager from AppState and onlineManager from NetInfo', () => {
    bindReactQueryToNativeLifecycle();
    bindReactQueryToNativeLifecycle(); // idempotent
    expect(native.appStateListeners).toHaveLength(1);
    expect(native.netInfoListeners).toHaveLength(1);

    native.appStateListeners[0]('background');
    expect(focusManager.isFocused()).toBe(false);
    native.appStateListeners[0]('active');
    expect(focusManager.isFocused()).toBe(true);

    native.netInfoListeners[0]({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
    native.netInfoListeners[0]({ isConnected: true });
    expect(onlineManager.isOnline()).toBe(true);
  });
});

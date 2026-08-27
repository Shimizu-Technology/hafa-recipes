import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  guestPromptHeight: 140,
  isSignedIn: false,
  pathname: '/discover',
}));

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('expo-router', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: mocks.isSignedIn }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  FadeIn: { duration: () => ({ springify: () => undefined }) },
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => ({ value }),
  withSpring: (value: number, _config: unknown, callback?: () => void) => {
    callback?.();
    return value;
  },
}));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({ tint: '#155C52' }),
}));
vi.mock('@/components/RecipeChatModal', () => ({ default: 'RecipeChatModal' }));
vi.mock('@/utils/haptics', () => ({ haptics: { medium: vi.fn() } }));
vi.mock('@/constants/Colors', () => ({
  brand: { clay: '#B94722' },
  spacing: { lg: 24 },
}));
vi.mock('@/lib/floatingChatLayout', () => ({
  floatingChatBottom: (isSignedIn: boolean, guestPromptHeight: number) => (
    96 + (isSignedIn ? 0 : guestPromptHeight)
  ),
  isFloatingChatPath: (pathname: string) => [
    '/',
    '/discover',
    '/history',
    '/planner',
    '/grocery',
  ].some((path) => pathname === path || pathname.endsWith(path)),
}));
vi.mock('../lib/guestPromptLayout', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/guestPromptLayout')>();
  return {
    ...original,
    useGuestPromptHeight: () => mocks.guestPromptHeight,
  };
});

import { floatingChatBottom, isFloatingChatPath } from '../lib/floatingChatLayout';
import FloatingChatButton from './FloatingChatButton';

describe('FloatingChatButton layout helpers', () => {
  beforeEach(() => {
    mocks.guestPromptHeight = 140;
    mocks.isSignedIn = false;
    mocks.pathname = '/discover';
  });

  it('covers every primary tab route, including the renamed planner route', () => {
    for (const pathname of [
      '/',
      '/discover',
      '/history',
      '/planner',
      '/grocery',
      '/(tabs)/planner',
    ]) {
      expect(isFloatingChatPath(pathname)).toBe(true);
    }

    expect(isFloatingChatPath('/recipe/recipe-1')).toBe(false);
    expect(isFloatingChatPath('/cook-mode/recipe-1')).toBe(false);
    expect(isFloatingChatPath('/settings')).toBe(false);
  });

  it('lifts the chat control above the guest account prompt', () => {
    const wrappedPromptHeight = 140;

    expect(floatingChatBottom(false, wrappedPromptHeight)).toBe(
      floatingChatBottom(true, wrappedPromptHeight) + wrappedPromptHeight,
    );
  });

  it('closes an open chat when the control becomes hidden', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(FloatingChatButton)));
      const button = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      )[0];
      await act(async () => button.props.onPress());

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'RecipeChatModal' && instance.props.isVisible,
      )).toHaveLength(1);

      mocks.pathname = '/recipe/recipe-1';
      await act(async () => renderer.render(React.createElement(FloatingChatButton)));
      expect(renderer.container.queryAll(() => true)).toHaveLength(0);

      mocks.pathname = '/discover';
      await act(async () => renderer.render(React.createElement(FloatingChatButton)));
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'RecipeChatModal' && !instance.props.isVisible,
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps chat closed when the guest prompt disappears and returns', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(FloatingChatButton)));
      const button = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      )[0];
      await act(async () => button.props.onPress());

      mocks.guestPromptHeight = 0;
      await act(async () => renderer.render(React.createElement(FloatingChatButton)));
      expect(renderer.container.queryAll(() => true)).toHaveLength(0);

      mocks.guestPromptHeight = 140;
      await act(async () => renderer.render(React.createElement(FloatingChatButton)));
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'RecipeChatModal' && !instance.props.isVisible,
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const keyboard = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
}));

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
  Keyboard: {
    isVisible: () => false,
    addListener: (event: string, callback: () => void) => {
      keyboard.listeners.set(event, callback);
      return { remove: () => keyboard.listeners.delete(event) };
    },
  },
}));
vi.mock('expo-router/build/react-navigation/bottom-tabs', () => ({ BottomTabBar: 'BottomTabBar' }));
vi.mock('@/components/AssistantFloatingButton', () => ({ AssistantFloatingButton: 'AssistantFloatingButton' }));
vi.mock('@/components/RecipeChatModal', () => ({ default: 'RecipeChatModal' }));
vi.mock('@/components/Themed', () => ({
  useColors: () => ({ backgroundElevated: '#202820' }),
}));

import { AssistantTabBar } from './AssistantTabBar';

describe('AssistantTabBar', () => {
  it('floats signed-in chat outside the tab-bar layout and keeps the native tab bar', async () => {
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(
        <AssistantTabBar isSignedIn={true} state={{} as never} navigation={{} as never}
          descriptors={{} as never} insets={{} as never} />,
      ));
      expect(renderer.container.queryAll((instance) => instance.type === 'BottomTabBar')).toHaveLength(1);
      const action = renderer.container.queryAll((instance) => instance.type === 'AssistantFloatingButton')[0].parent;
      expect(action?.props.style).toMatchObject({ position: 'absolute', bottom: '100%', right: 16 });
      const tabBarContainer = renderer.container.queryAll((instance) => instance.type === 'View')[0];
      expect(tabBarContainer.children[0]).toHaveProperty('type', 'BottomTabBar');

      await act(async () => renderer.container.queryAll(
        (instance) => instance.type === 'AssistantFloatingButton',
      )[0].props.onPress());
      expect(renderer.container.queryAll((instance) => instance.type === 'RecipeChatModal')[0]
        .props.isVisible).toBe(true);

      await act(async () => keyboard.listeners.get('keyboardDidShow')?.());
      expect(renderer.container.queryAll((instance) => instance.type === 'AssistantFloatingButton')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'RecipeChatModal')[0]
        .props.isVisible).toBe(true);

      await act(async () => keyboard.listeners.get('keyboardDidHide')?.());
      expect(renderer.container.queryAll((instance) => instance.type === 'AssistantFloatingButton')).toHaveLength(1);
      await act(async () => renderer.container.queryAll(
        (instance) => instance.type === 'RecipeChatModal',
      )[0].props.onClose());
      expect(renderer.container.queryAll((instance) => instance.type === 'RecipeChatModal')[0]
        .props.isVisible).toBe(false);

      await act(async () => renderer.render(
        <AssistantTabBar isSignedIn={false} state={{} as never} navigation={{} as never}
          descriptors={{} as never} insets={{} as never} />,
      ));
      expect(renderer.container.queryAll((instance) => instance.type === 'RecipeChatModal')).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('does not show a chat entry for signed-out users', async () => {
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(
        <AssistantTabBar isSignedIn={false} state={{} as never} navigation={{} as never}
          descriptors={{} as never} insets={{} as never} />,
      ));
      expect(renderer.container.queryAll((instance) => instance.type === 'AssistantFloatingButton')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'BottomTabBar')).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

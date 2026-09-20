import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({ tint: '#155C52' }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'DMSans_600SemiBold' },
  radius: { full: 9999 },
}));
vi.mock('@/utils/haptics', () => ({ haptics: { medium: vi.fn() } }));

import { AssistantDockButton } from './AssistantDockButton';

describe('AssistantDockButton', () => {
  it('labels the chat action visibly and activates it', async () => {
    const renderer = createRoot();
    const onPress = vi.fn();

    try {
      await act(async () => renderer.render(<AssistantDockButton onPress={onPress} />));
      const button = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Ask Håfa',
      )[0];
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.style[0].minHeight).toBe(44);
      expect(button.props.style[0]).not.toHaveProperty('position');
      expect(renderer.container.queryAll((instance) => instance.type === 'Ionicons')[0].props.name)
        .toBe('chatbubble-ellipses-outline');
      expect(renderer.container.queryAll((instance) => instance.type === 'Text')[0].props.children)
        .toBe('Ask Håfa');
      await act(async () => button.props.onPress());
      expect(onPress).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

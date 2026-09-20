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
vi.mock('@/components/RecipeChatModal', () => ({ default: 'RecipeChatModal' }));
vi.mock('@/components/Themed', () => ({ useColors: () => ({ tint: '#155C52' }) }));
vi.mock('@/constants/Colors', () => ({ radius: { full: 9999 } }));
vi.mock('@/utils/haptics', () => ({ haptics: { medium: vi.fn() } }));

import { AssistantHeaderButton } from './AssistantHeaderButton';

describe('AssistantHeaderButton', () => {
  it('opens and closes cooking help from a non-floating 44-point header target', async () => {
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(<AssistantHeaderButton />));
      const button = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Ask Håfa cooking assistant',
      )[0];
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.style[0]).toMatchObject({ width: 44, height: 44 });
      expect(button.props.style[0]).not.toHaveProperty('position');
      expect(renderer.container.queryAll((instance) => instance.type === 'RecipeChatModal')).toHaveLength(0);

      await act(async () => button.props.onPress());
      const modal = renderer.container.queryAll(
        (instance) => instance.type === 'RecipeChatModal',
      )[0];
      expect(modal.props.isVisible).toBe(true);

      await act(async () => modal.props.onClose());
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'RecipeChatModal' && !instance.props.isVisible,
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

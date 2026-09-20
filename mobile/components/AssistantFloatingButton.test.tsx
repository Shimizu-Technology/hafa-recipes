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
  useColors: () => ({ tint: '#155C52', backgroundElevated: '#202820', shadowColor: '#0B3E38' }),
}));
vi.mock('@/constants/Colors', () => ({
  radius: { full: 9999 },
}));
vi.mock('@/utils/haptics', () => ({ haptics: { medium: vi.fn() } }));

import { AssistantFloatingButton } from './AssistantFloatingButton';

describe('AssistantFloatingButton', () => {
  it('keeps an accessible chat label and a compact, tappable icon', async () => {
    const renderer = createRoot();
    const onPress = vi.fn();

    try {
      await act(async () => renderer.render(<AssistantFloatingButton onPress={onPress} />));
      const button = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Ask Håfa',
      )[0];
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.style[0].width).toBe(54);
      expect(button.props.style[0].height).toBe(54);
      expect(button.props.style[0]).not.toHaveProperty('position');
      expect(renderer.container.queryAll((instance) => instance.type === 'Ionicons')[0].props.name)
        .toBe('chatbubble-ellipses');
      expect(renderer.container.queryAll((instance) => instance.type === 'Text')).toHaveLength(0);
      await act(async () => button.props.onPress());
      expect(onPress).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

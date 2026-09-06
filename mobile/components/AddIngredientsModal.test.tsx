import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('./Themed', () => ({
  Text: 'Text',
  View: 'View',
  useColors: () => ({
    border: '#ddd',
    card: '#fff',
    cardBorder: '#ddd',
    text: '#111',
    textMuted: '#666',
    tint: '#155c52',
    warning: '#8a5a00',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { md: 12 },
  spacing: { sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/hooks/useScaledServings', () => ({
  scaleQuantity: (quantity: string | null) => quantity,
}));

import AddIngredientsModal from './AddIngredientsModal';

describe('AddIngredientsModal', () => {
  it('keeps an unstated amount visible before groceries are added', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(AddIngredientsModal, {
          visible: true,
          onClose: vi.fn(),
          onConfirm: vi.fn(),
          recipeTitle: 'Chicken Kelaguen',
          ingredients: [
            { name: 'Chicken', quantity: '2', unit: 'lb' },
            { name: 'Salt', quantity: null, unit: 'tsp' },
          ],
        }));
      });

      const text = renderer.container.queryAll((instance) => instance.type === 'Text');
      expect(text.some((node) => node.props.children === 'Amount not stated')).toBe(true);
      expect(JSON.stringify(renderer.container.toJSON())).not.toContain('tsp');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('normalizes unstated amounts in the confirmation payload', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    const onConfirm = vi.fn();

    try {
      await act(async () => {
        renderer.render(React.createElement(AddIngredientsModal, {
          visible: true,
          onClose: vi.fn(),
          onConfirm,
          recipeTitle: 'Red Rice',
          ingredients: [
            { name: 'Water', quantity: null, unit: 'cups' },
            { name: 'Salt', quantity: 'null', unit: 'tsp' },
            { name: 'Pepper', quantity: '   ', unit: 'tsp' },
            { name: 'Rice', quantity: '2', unit: 'cups' },
          ],
        }));
      });

      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      await act(async () => buttons[1].props.onPress());

      expect(onConfirm).toHaveBeenCalledWith([
        { name: 'Water', quantity: null, unit: 'cups' },
        { name: 'Salt', quantity: null, unit: 'tsp' },
        { name: 'Pepper', quantity: null, unit: 'tsp' },
        { name: 'Rice', quantity: '2', unit: 'cups' },
      ]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

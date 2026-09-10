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
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

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
            { name: 'Pepper', quantity: '1', unit: ' NULL ' },
            { name: 'Oil', quantity: '1', unit: ' tbsp ' },
          ],
        }));
      });

      const text = renderer.container.queryAll((instance) => instance.type === 'Text');
      expect(text.some((node) => node.props.children === 'Amount not stated')).toBe(true);
      const rendered = JSON.stringify(renderer.container.toJSON());
      expect(rendered).not.toContain('tsp');
      expect(rendered).not.toContain('NULL');
      expect(rendered).toContain('tbsp ');
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
            { name: 'Salt', quantity: 'null', unit: ' NULL ' },
            { name: 'Pepper', quantity: '   ', unit: '   ' },
            { name: 'Rice', quantity: '2', unit: ' cups ' },
          ],
        }));
      });

      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      await act(async () => buttons[1].props.onPress());

      expect(onConfirm).toHaveBeenCalledWith([
        { name: 'Water', quantity: null, unit: 'cups' },
        { name: 'Salt', quantity: null, unit: null },
        { name: 'Pepper', quantity: null, unit: null },
        { name: 'Rice', quantity: '2', unit: 'cups' },
      ]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});


it('shows and scales AI amounts without changing source quantity in the selected ingredients', async () => {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  const onConfirm = vi.fn();
  try {
    await act(async () => {
      renderer.render(React.createElement(AddIngredientsModal, {
        visible: true, onClose: vi.fn(), onConfirm, recipeTitle: 'Rice', scaleFactor: 2,
        ingredients: [{ name: 'Water', quantity: null, unit: null, quantityEstimate: { quantity: '1/2', unit: 'cup', reason: 'Based on the rice.' } }],
      }));
    });
    expect(JSON.stringify(renderer.container.toJSON())).toContain('AI estimate');
    const buttons = renderer.container.queryAll(instance => instance.type === 'TouchableOpacity');
    await act(async () => buttons[1].props.onPress());
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({
      quantity: null, unit: null, quantityEstimate: { quantity: '1', unit: 'cup', reason: 'Based on the rice.' },
    })]);
  } finally { await act(async () => renderer.unmount()); }
});


it('shows useful ingredient notes while hiding adjacent extraction diagnostics', async () => {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  try {
    await act(async () => {
      renderer.render(React.createElement(AddIngredientsModal, {
        visible: true, onClose: vi.fn(), onConfirm: vi.fn(), recipeTitle: 'Cookies',
        ingredients: [
          { name: 'Butter', quantity: '1', unit: 'cup', notes: 'Amount omitted; use softened butter.' },
          { name: 'Flour', quantity: '2', unit: 'cups', notes: 'The video contains a tip: fold gently.' },
        ],
      }));
    });
    const rendered = JSON.stringify(renderer.container.toJSON());
    expect(rendered).toContain('use softened butter.');
    expect(rendered).toContain('The video contains a tip: fold gently.');
    expect(rendered).not.toContain('Amount omitted');
  } finally { await act(async () => renderer.unmount()); }
});

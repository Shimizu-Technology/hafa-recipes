import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  useWindowDimensions: () => ({ fontScale: 1 }),
  ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity', Alert: { alert: vi.fn() },
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));
vi.mock('@/components/Themed', () => ({ Text: 'Text', Card: 'Card', useColors: () => ({ text: '#000', actionText: '#166456', border: '#ccc' }) }));
vi.mock('@/constants/Colors', () => ({
  brand: { reefHighlight: '#4dc7b8' },
  fontSize: { sm: 12, md: 16 },
  fontWeight: { medium: '500' },
  spacing: { sm: 8, lg: 24 },
}));
vi.mock('@/hooks/useScaledServings', () => ({
  scaleQuantity: (quantity: string | null, factor: number) => (
    quantity === '2' ? String(Number(quantity) * factor) : quantity
  ),
}));

vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));

import { CookIngredientsList } from './CookIngredientsList';

describe('CookIngredientsList', () => {
  it('explains an empty ingredient list', async () => {
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(<CookIngredientsList ingredients={[]} scaleFactor={1} isScaled={false} warningColor="#b70" scaleFontSize={size => size} />));
      expect(renderer.container.queryAll(node => node.type === 'Text').map(node => node.props.children)).toContain('No ingredients listed');
    } finally { await act(async () => renderer.unmount()); }
  });
  it('renders scaled amounts and labels missing or legacy-sentinel amounts', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => {
        renderer.render(React.createElement(CookIngredientsList, {
          ingredients: [
            { name: 'Rice', quantity: '2', unit: 'cups' },
            { name: 'Salt', quantity: null, unit: 'tsp' },
            { name: 'Pepper', quantity: ' NULL ', unit: 'tbsp' },
            { name: 'Seasoning', quantity: null, unit: 'to taste', quantityEstimate: { quantity: '9', unit: 'tsp', reason: 'Stale suggestion.' } },
            { name: 'Milk', quantity: null, unit: null, quantityEstimate: { quantity: '2', unit: 'cups', reason: 'For this batch.' } },
          ],
          scaleFactor: 2,
          isScaled: true,
          warningColor: '#b70',
          scaleFontSize: (size: number) => size,
        }));
      });

      const rendered = renderer.container.queryAll((instance) => instance.type === 'Text')
        .flatMap((instance) => instance.props.children ?? [])
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
      expect(rendered.match(/4 cups/g)).toHaveLength(2);
      expect(rendered).toContain('AI estimate');
      expect(rendered).toContain('to taste');
      expect(rendered).not.toContain('9');
      expect(rendered.match(/Amount not stated/g)).toHaveLength(2);
      expect(rendered).not.toContain('tsp');
      expect(rendered).not.toContain('tbsp');
    } finally {
      await act(async () => renderer.unmount());
    }
  });
  it('renders populated component groups in order and omits empty groups', async () => {
    const renderer = createRoot();
    const rice = { name: 'Rice', quantity: '2', unit: 'cups' };
    const salt = { name: 'Salt', quantity: null, unit: null };
    const milk = { name: 'Milk', quantity: null, unit: null };
    try {
      await act(async () => renderer.render(<CookIngredientsList ingredients={[rice, salt, milk]}
        components={[{ name: 'Base', ingredients: [rice, salt], steps: [] }, { name: 'Empty', ingredients: [], steps: [] }, { name: 'Sauce', ingredients: [milk], steps: [] }]}
        scaleFactor={1} isScaled={false} warningColor="#b70" scaleFontSize={size => size} />));
      const text = renderer.container.queryAll(node => node.type === 'Text').map(node => node.props.children).flat(Infinity).filter(value => typeof value === 'string').join(' ');
      expect(text).not.toContain('Empty');
      expect(text.indexOf('Base')).toBeLessThan(text.indexOf('Rice'));
      expect(text.indexOf('Rice')).toBeLessThan(text.indexOf('Salt'));
      expect(text.indexOf('Salt')).toBeLessThan(text.indexOf('Sauce'));
      expect(text.indexOf('Sauce')).toBeLessThan(text.indexOf('Milk'));
    } finally { await act(async () => renderer.unmount()); }
  });

});

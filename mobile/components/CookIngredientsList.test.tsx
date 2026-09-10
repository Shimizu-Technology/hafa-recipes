import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));
vi.mock('@/components/Themed', () => ({ Text: 'Text' }));
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

import { CookIngredientsList } from './CookIngredientsList';

describe('CookIngredientsList', () => {
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
});

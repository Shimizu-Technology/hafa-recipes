import { describe, expect, it, vi } from 'vitest';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
import { scaleIngredient, scaleQuantity } from './useScaledServings';
import { ingredientToGroceryItem } from '../lib/recipeTrust';

describe('scaled recipe amounts', () => {
  it.each([['1/2', 2, '1'], ['1 1/2', 2, '3'], ['1½', 2, '3'], ['¾', 2, '1.5'], ['0.5', 0.5, '¼'], ['2', 2, '4']])(
    'scales %s by %s without parsing a fraction as a whole number', (quantity, factor, expected) => {
      expect(scaleQuantity(String(quantity), Number(factor))).toBe(expected);
    },
  );
  it.each(['1-2', 'to taste', '1/0', '2 large'])('leaves ambiguous amount %s unchanged', quantity => {
    expect(scaleQuantity(quantity, 2)).toBe(quantity);
  });
  it('scales a suggested amount separately and retains the AI label in groceries', () => {
    const original = { name: 'Milk', quantity: null, unit: null, quantityEstimate: { quantity: '1/2', unit: 'cup', reason: 'For the stated flour amount.' } };
    const scaled = scaleIngredient(original, 2);
    expect(scaled.quantity).toBeNull();
    expect(scaled.quantityEstimate).toEqual({ ...original.quantityEstimate, quantity: '1' });
    expect(original.quantityEstimate.quantity).toBe('1/2');
    expect(ingredientToGroceryItem(scaled)).toMatchObject({ quantity: '1', unit: 'cup', notes: 'AI estimate: For the stated flour amount.' });
  });
});

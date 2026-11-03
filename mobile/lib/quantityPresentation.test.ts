import { describe, expect, it } from 'vitest';
import { formatIngredientAmount, formatQuantity, spokenQuantity } from './quantityPresentation';

describe('display-only cooking quantities', () => {
  it.each([
    ['0.5', '½'], ['0.333', '⅓'], ['0.667', '⅔'], ['0.25', '¼'], ['0.75', '¾'],
    ['0.125', '⅛'], ['0.375', '⅜'], ['0.625', '⅝'], ['0.875', '⅞'],
    ['1.5', '1½'], ['2.333', '2⅓'], ['1 1/2', '1½'], ['1½', '1½'],
    ['0.27', '¼'], ['0.29', '0.3'], ['3.19', '3.2'], ['25.43', '25'], ['0.001', '0.001'],
    ['1–2', '1–2'], ['a pinch', 'a pinch'], ['1-2', '1-2'], ['1/0', '1/0'],
  ])('formats %s as %s', (input, expected) => expect(formatQuantity(input, 'cup')).toBe(expected));
  it.each(['g', 'kg', 'ml', 'l', 'grams', 'Litres', 'mL'])('keeps %s decimal', unit => {
    expect(formatQuantity('1.5', unit)).toBe('1.5');
    expect(formatQuantity('125', unit)).toBe('125');
    expect(formatQuantity('1/4', unit)).toBe('0.25');
  });
  it('shows a scaled amount that rounds to a half as a fraction', () => {
    expect(formatQuantity(String(2.5 * 7 / 12), 'tbsp')).toBe('1½');
    expect(formatQuantity('0.46', 'cup')).toBe('½');
    expect(formatQuantity('1.42', 'cup')).toBe('1.4');
    expect(formatQuantity('10.5', 'cup')).toBe('10½');
    expect(formatQuantity(String(2.5 * 7 / 12), 'g')).toBe('1.458');
  });
  it('preserves absence and gives naturally separated VoiceOver fractions', () => {
    expect(formatQuantity(null)).toBeNull();
    expect(formatIngredientAmount('1.5', 'tsp')).toBe('1½ tsp');
    expect(spokenQuantity('1½ tsp salt, ¼ cup oil')).toBe('1 and 1/2 tsp salt, 1/4 cup oil');
  });
});

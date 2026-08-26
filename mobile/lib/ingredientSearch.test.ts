import { describe, expect, it } from 'vitest';

import { mergeIngredientSearchInput, parseIngredientSearchInput } from './ingredientSearch';

describe('parseIngredientSearchInput', () => {
  it('accepts comma-separated and line-separated pasted ingredients', () => {
    expect(parseIngredientSearchInput('Chicken, rice\nGarlic\nolive oil')).toEqual([
      'chicken',
      'rice',
      'garlic',
      'olive oil',
    ]);
  });

  it('removes blank and duplicate ingredients while preserving order', () => {
    expect(parseIngredientSearchInput(' Rice, ,rice\nCHICKEN, chicken ')).toEqual([
      'rice',
      'chicken',
    ]);
  });
});

describe('mergeIngredientSearchInput', () => {
  it('adds a pasted batch without duplicating active ingredients', () => {
    expect(mergeIngredientSearchInput(
      ['rice', 'chicken'],
      'Chicken, garlic\nGreen onions',
    )).toEqual(['rice', 'chicken', 'garlic', 'green onions']);
  });

  it('normalizes active ingredients before deduplicating new input', () => {
    expect(mergeIngredientSearchInput([' Chicken '], 'chicken')).toEqual(['chicken']);
  });
});

import { describe, expect, it } from 'vitest';

import {
  formatIngredientAmount,
  getIngredientAmount,
  ingredientToGroceryItem,
  getCookingNotes,
  getRecipeTrustPresentation,
  hasStatedIngredientAmount,
  MISSING_AMOUNT_LABEL,
  normalizeIngredientUnit,
} from './recipeTrust';

describe('recipe trust presentation', () => {
  it('labels only recipe states that still need owner attention', () => {
    expect(getRecipeTrustPresentation('source_incomplete')).toEqual({
      label: 'Needs details',
      accessibilityLabel: 'Recipe needs source details',
    });
    expect(getRecipeTrustPresentation('needs_review')?.label).toBe('Some details uncertain');
    expect(getRecipeTrustPresentation('ready')).toBeNull();
    expect(getRecipeTrustPresentation(null)).toBeNull();
  });

  it('recognizes missing and legacy sentinel quantities', () => {
    expect(hasStatedIngredientAmount(null)).toBe(false);
    expect(hasStatedIngredientAmount(undefined)).toBe(false);
    expect(hasStatedIngredientAmount('')).toBe(false);
    expect(hasStatedIngredientAmount('  ')).toBe(false);
    expect(hasStatedIngredientAmount('null')).toBe(false);
    expect(hasStatedIngredientAmount(' NULL ')).toBe(false);
    expect(hasStatedIngredientAmount('2')).toBe(true);
    expect(MISSING_AMOUNT_LABEL).toBe('Amount not stated');
  });

  it('formats Cook Mode amounts without exposing legacy unit sentinels', () => {
    expect(formatIngredientAmount('2', 'tbsp')).toBe('2 tbsp');
    expect(formatIngredientAmount('2', 'null')).toBe('2');
    expect(formatIngredientAmount('2', ' NULL ')).toBe('2');
    expect(formatIngredientAmount('2', null, '4')).toBe('4');
    expect(formatIngredientAmount(null, 'tsp')).toBe(MISSING_AMOUNT_LABEL);
  });

  it('normalizes units shared by display, export, and persistence', () => {
    expect(normalizeIngredientUnit(null)).toBeNull();
    expect(normalizeIngredientUnit('   ')).toBeNull();
    expect(normalizeIngredientUnit(' NULL ')).toBeNull();
    expect(normalizeIngredientUnit(' tbsp ')).toBe('tbsp');
  });
});


describe('ingredient estimate provenance', () => {
  const estimate = { quantity: '0.5', unit: 'cup', reason: 'Based on the stated flour amount.' };
  it('uses an estimate without changing source quantities and always prefers a stated amount', () => {
    const ingredient = { name: 'Milk', quantity: null, unit: null, quantityEstimate: estimate };
    expect(getIngredientAmount(ingredient)).toEqual({ quantity: '0.5', unit: 'cup', reason: estimate.reason, isEstimate: true });
    expect(ingredient.quantity).toBeNull();
    expect(getIngredientAmount({ ...ingredient, quantity: '2', unit: 'tbsp' })).toEqual({ quantity: '2', unit: 'tbsp', isEstimate: false, reason: null });
    expect(getIngredientAmount({ ...ingredient, quantityEstimate: { ...estimate, quantity: 'null' } }).isEstimate).toBe(false);
  });
  it('carries the amount and an explicit AI label into grocery notes', () => {
    expect(ingredientToGroceryItem({ name: 'Milk', quantity: null, unit: null, notes: 'Room temperature', quantityEstimate: estimate })).toEqual({
      name: 'Milk', quantity: '0.5', unit: 'cup', notes: `AI estimate: ${estimate.reason} · Room temperature`,
    });
    expect(ingredientToGroceryItem({ name: 'Milk', quantity: '2', unit: 'tbsp', quantityEstimate: estimate }).notes).toBeNull();
  });
});

describe('cooking notes', () => {
  it('hides the legacy diagnostic shown in the user screenshot', () => {
    expect(getCookingNotes('The description identifies the dish and broad preparation concept but does not provide a full ingredient list, measurements, temperatures, timings, or detailed instructions.')).toBeNull();
  });
  it('keeps real cooking tips, including tips next to an extraction diagnostic', () => {
    expect(getCookingNotes('Chill the dough overnight. The source does not provide measurements. Freeze the filling before shaping.')).toBe('Chill the dough overnight. Freeze the filling before shaping.');
    expect(getCookingNotes('The video shows a softer dough. Add flour only if it sticks.')).toBe('The video shows a softer dough. Add flour only if it sticks.');
    expect(getCookingNotes('null')).toBeNull();
  });
});

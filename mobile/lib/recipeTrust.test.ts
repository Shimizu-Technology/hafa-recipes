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
  it('omits amount diagnostics but retains ingredient preparation tips', () => {
    expect(getCookingNotes('Amount omitted. Finely mince the garlic.')).toBe('Finely mince the garlic.');
    expect(getCookingNotes('Quantity not stated.')).toBeNull();
  });
  it('keeps real cooking tips, including tips next to an extraction diagnostic', () => {
    expect(getCookingNotes('Chill the dough overnight. The source does not provide measurements. Freeze the filling before shaping.')).toBe('Chill the dough overnight. Freeze the filling before shaping.');
    expect(getCookingNotes('The video shows a softer dough. Add flour only if it sticks.')).toBe('The video shows a softer dough. Add flour only if it sticks.');
    expect(getCookingNotes('null')).toBeNull();
  });
});


describe('legacy amount sentinels', () => {
  it.each(['none', 'n/a', 'not stated', 'unknown'].flatMap(value => [value, value.toUpperCase(), `  ${value}  `]))(
    'treats %j as unstated rather than a usable ingredient amount', value => {
      expect(hasStatedIngredientAmount(value)).toBe(false);
      expect(formatIngredientAmount(value, 'cups')).toBe(MISSING_AMOUNT_LABEL);
    },
  );
});

describe('source flexibility overrides stale estimates', () => {
  it.each(['name', 'unit', 'notes'] as const)('keeps qualitative source language from %s', field => {
    for (const phrase of ['to taste', 'AS NEEDED', ' as desired ', 'for garnish', 'optional']) {
      const source = { [field]: phrase, quantityEstimate: { quantity: '1', unit: 'tsp', reason: 'An old estimate.' } };
      const amount = getIngredientAmount(source);
      expect(amount).toMatchObject({ quantity: phrase.trim().toLowerCase(), unit: null, isEstimate: false, reason: null });
      expect(formatIngredientAmount(amount.quantity, amount.unit)).toBe(phrase.trim().toLowerCase());
      expect(source).not.toHaveProperty('quantity');
    }
  });
  it('keeps a constrained total eligible for an arithmetic estimate', () => {
    expect(getIngredientAmount({ name: 'Water', notes: 'Add enough water for a total of 2 cups of cooking liquid.', quantityEstimate: { quantity: '1', unit: 'cup', reason: '2 cups total minus 1 cup broth.' } })).toMatchObject({ quantity: '1', unit: 'cup', isEstimate: true });
  });
  it('continues to use an estimate when optional source fields are absent', () => {
    expect(getIngredientAmount({ quantityEstimate: { quantity: '1', unit: 'tsp', reason: 'For this batch.' } })).toMatchObject({ quantity: '1', unit: 'tsp', isEstimate: true });
  });
});

describe('diagnostic notes retain cooking guidance', () => {
  it.each([
    'The video contains a tip: chill the dough overnight.',
    'The caption provides cooking tips: use softened butter.',
    'The source only uses a little water to bring the dough together.',
    'Fold gently, then chill; bake until golden.',
  ])('preserves the useful note %j', note => {
    expect(getCookingNotes(note)).toBe(note);
  });
  it.each([
    ['Amount omitted; use softened butter.', 'use softened butter.'],
    ['The source does not state quantities, chill the dough overnight.', 'chill the dough overnight.'],
    ['Chill the dough overnight, amount omitted.', 'Chill the dough overnight'],
    ['Chill the dough overnight; the source does not state quantities.', 'Chill the dough overnight'],
  ])('keeps cooking clauses in %j', (note, expected) => {
    expect(getCookingNotes(note)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';

import { parseGroceryItemInput } from './groceryItemInput';

describe('parseGroceryItemInput', () => {
  it('splits an amount and unit from the name', () => {
    expect(parseGroceryItemInput('2 lb chicken thighs')).toEqual({ name: 'chicken thighs', quantity: '2', unit: 'lb' });
    expect(parseGroceryItemInput('2lbs  ground beef')).toEqual({ name: 'ground beef', quantity: '2', unit: 'lbs' });
    expect(parseGroceryItemInput('1 1/2 cups rice')).toEqual({ name: 'rice', quantity: '1 1/2', unit: 'cups' });
    expect(parseGroceryItemInput('½ cup soy sauce')).toEqual({ name: 'soy sauce', quantity: '½', unit: 'cup' });
    expect(parseGroceryItemInput('2 cans of coconut milk')).toEqual({ name: 'coconut milk', quantity: '2', unit: 'cans' });
    expect(parseGroceryItemInput('1 Tbsp. fish sauce')).toEqual({ name: 'fish sauce', quantity: '1', unit: 'Tbsp' });
    expect(parseGroceryItemInput('1 ½ cups rice')).toEqual({ name: 'rice', quantity: '1 ½', unit: 'cups' });
  });

  it('keeps a count without a unit', () => {
    expect(parseGroceryItemInput('12 eggs')).toEqual({ name: 'eggs', quantity: '12', unit: null });
    expect(parseGroceryItemInput('1.5 avocados')).toEqual({ name: 'avocados', quantity: '1.5', unit: null });
  });

  it('leaves anything without a leading amount as typed', () => {
    expect(parseGroceryItemInput('  Paper towels ')).toEqual({ name: 'Paper towels', quantity: null, unit: null });
    expect(parseGroceryItemInput('7up')).toEqual({ name: '7up', quantity: null, unit: null });
    expect(parseGroceryItemInput('Eggs 12')).toEqual({ name: 'Eggs 12', quantity: null, unit: null });
    expect(parseGroceryItemInput('2 lb')).toEqual({ name: '2 lb', quantity: null, unit: null });
    expect(parseGroceryItemInput('2')).toEqual({ name: '2', quantity: null, unit: null });
    // A word that only starts like a unit is part of the name.
    expect(parseGroceryItemInput('2 lemons')).toEqual({ name: 'lemons', quantity: '2', unit: null });
    expect(parseGroceryItemInput('3 green onions')).toEqual({ name: 'green onions', quantity: '3', unit: null });
    // An "amount" longer than the server allows stays in the name.
    const long = `${'9'.repeat(51)} eggs`;
    expect(parseGroceryItemInput(long)).toEqual({ name: long, quantity: null, unit: null });
    expect(parseGroceryItemInput(`${'9'.repeat(51)} lb rice`).quantity).toBeNull();
  });
});

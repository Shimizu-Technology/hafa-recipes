import { describe, expect, it } from 'vitest';

import type { GroceryItem } from '../types/recipe';
import { filterGroceryItems } from './groceryFilters';

function item(overrides: Partial<GroceryItem> & Pick<GroceryItem, 'id' | 'name'>): GroceryItem {
  return {
    quantity: null,
    unit: null,
    notes: null,
    checked: false,
    recipe_id: null,
    recipe_title: null,
    added_by_name: null,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
    ...overrides,
  };
}

const groceries = [
  item({ id: 'rice', name: 'Calrose rice', quantity: '2', unit: 'cups', recipe_title: 'Chicken Kelaguen' }),
  item({ id: 'lime', name: 'Limes', notes: 'fresh, not bottled', recipe_title: 'Chicken Kelaguen' }),
  item({ id: 'cream', name: 'Crème fraîche', added_by_name: 'Leon' }),
];

describe('filterGroceryItems', () => {
  it('returns a new unfiltered list for an empty query', () => {
    const result = filterGroceryItems(groceries, '   ');

    expect(result).toEqual(groceries);
    expect(result).not.toBe(groceries);
  });

  it('matches item details, recipe titles, and contributor names', () => {
    expect(filterGroceryItems(groceries, '2 cups')).toEqual([groceries[0]]);
    expect(filterGroceryItems(groceries, 'fresh bottled')).toEqual([groceries[1]]);
    expect(filterGroceryItems(groceries, 'kelaguen lime')).toEqual([groceries[1]]);
    expect(filterGroceryItems(groceries, 'leon')).toEqual([groceries[2]]);
  });

  it('is case-insensitive and accent-insensitive', () => {
    expect(filterGroceryItems(groceries, 'CREME FRAICHE')).toEqual([groceries[2]]);
  });

  it('requires every query term to match the same item', () => {
    expect(filterGroceryItems(groceries, 'rice lime')).toEqual([]);
  });
});

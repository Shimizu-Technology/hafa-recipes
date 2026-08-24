import { describe, expect, it } from 'vitest';

import type { GroceryItem } from '../types/recipe';
import {
  groupGroceryItems,
  OTHER_GROCERY_SECTION_KEY,
} from './grocerySections';

function item(overrides: Partial<GroceryItem> & Pick<GroceryItem, 'id' | 'name'>): GroceryItem {
  return {
    quantity: null,
    unit: null,
    notes: null,
    checked: false,
    recipe_id: null,
    recipe_title: null,
    added_by_name: null,
    created_at: '2026-08-24T00:00:00Z',
    updated_at: '2026-08-24T00:00:00Z',
    ...overrides,
  };
}

describe('groupGroceryItems', () => {
  it('orders recipe sections by title, keeps API item order, and puts manual items last', () => {
    const sections = groupGroceryItems([
      item({ id: 'b2', name: 'Basil', recipe_id: 'recipe-b', recipe_title: 'Ziti' }),
      item({ id: 'manual', name: 'Soap' }),
      item({ id: 'a1', name: 'Rice', recipe_id: 'recipe-a', recipe_title: 'Adobo' }),
      item({ id: 'b1', name: 'Pasta', recipe_id: 'recipe-b', recipe_title: 'Ziti' }),
    ]);

    expect(sections.map((section) => section.title)).toEqual(['Adobo', 'Ziti', 'Other Items']);
    expect(sections[1].data.map((entry) => entry.id)).toEqual(['b2', 'b1']);
    expect(sections[2].key).toBe(OTHER_GROCERY_SECTION_KEY);
  });

  it('does not merge different recipes that have the same title', () => {
    const sections = groupGroceryItems([
      item({ id: 'one', name: 'First', recipe_id: 'recipe-1', recipe_title: 'Soup' }),
      item({ id: 'two', name: 'Second', recipe_id: 'recipe-2', recipe_title: 'Soup' }),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.key)).toEqual([
      'recipe:recipe-1',
      'recipe:recipe-2',
    ]);
  });

  it('keeps legacy recipe-title items grouped instead of treating them as manual', () => {
    const sections = groupGroceryItems([
      item({ id: 'legacy', name: 'Pepper', recipe_title: 'Old Recipe' }),
    ]);

    expect(sections[0]).toMatchObject({
      key: 'recipe-title:old recipe',
      title: 'Old Recipe',
      recipeId: null,
    });
  });

  it('keeps distinct legacy titles separate when only their diacritics differ', () => {
    const sections = groupGroceryItems([
      item({ id: 'accented', name: 'One', recipe_title: 'Crème' }),
      item({ id: 'plain', name: 'Two', recipe_title: 'Creme' }),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.key)).toEqual([
      'recipe-title:creme',
      'recipe-title:crème',
    ]);
  });
});

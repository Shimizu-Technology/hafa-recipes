import { describe, expect, it } from 'vitest';

import {
  buildMealPlanEntry,
  parsePlannerDateParam,
  parsePlannerRecipeParam,
} from './plannerNavigation';

describe('planner navigation parameters', () => {
  it('parses a valid local calendar date', () => {
    const result = parsePlannerDateParam('2026-08-27');

    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(7);
    expect(result?.getDate()).toBe(27);
  });

  it.each([undefined, '', '08-27-2026', '2026-02-30', '2026-13-01'])(
    'rejects invalid planner date %s',
    (value) => {
      expect(parsePlannerDateParam(value)).toBeNull();
    },
  );
});

describe('planner recipe parameters', () => {
  it('accepts a canonical recipe UUID', () => {
    expect(parsePlannerRecipeParam('91E74F66-DBA0-4FB0-B879-AE2F8C59626E')).toBe(
      '91e74f66-dba0-4fb0-b879-ae2f8c59626e',
    );
  });

  it.each([undefined, '', 'recipe-1', '91e74f66-dba0-0fb0-b879-ae2f8c59626e'])(
    'rejects invalid recipe parameter %s',
    (value) => {
      expect(parsePlannerRecipeParam(value)).toBeNull();
    },
  );
});

describe('recipe-to-slot handoff', () => {
  it('builds the exact meal-plan mutation from the trusted recipe record and chosen slot', () => {
    expect(buildMealPlanEntry({
      id: '91e74f66-dba0-4fb0-b879-ae2f8c59626e',
      title: 'Chicken Kelaguen',
      thumbnail_url: 'https://example.com/kelaguen.jpg',
    }, '2026-08-29', 'dinner')).toEqual({
      date: '2026-08-29',
      meal_type: 'dinner',
      recipe_id: '91e74f66-dba0-4fb0-b879-ae2f8c59626e',
      recipe_title: 'Chicken Kelaguen',
      recipe_thumbnail: 'https://example.com/kelaguen.jpg',
    });
  });
});

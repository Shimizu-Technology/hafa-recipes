import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { MealPlanEntry, WeekPlan } from '@/types/recipe';

vi.mock('@/lib/api', () => ({ api: {} }));

import { mealPlanKeys } from './useMealPlan';

describe('meal plan query keys', () => {
  it('keeps optimistic week updates away from recipe relationship lists', () => {
    const queryClient = new QueryClient();
    const weekKey = mealPlanKeys.week('2026-08-24');
    const recipeKey = mealPlanKeys.recipe('recipe-1', '2026-08-26');
    const week: WeekPlan = {
      week_start: '2026-08-24',
      week_end: '2026-08-30',
      days: [],
    };
    const relationships: MealPlanEntry[] = [];
    queryClient.setQueryData(weekKey, week);
    queryClient.setQueryData(recipeKey, relationships);

    queryClient.setQueriesData(
      { queryKey: mealPlanKeys.weeks() },
      (current) => ({ ...(current as WeekPlan), week_start: 'updated' }),
    );

    expect(queryClient.getQueryData(weekKey)).toMatchObject({ week_start: 'updated' });
    expect(queryClient.getQueryData(recipeKey)).toBe(relationships);
  });
});

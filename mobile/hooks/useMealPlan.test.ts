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

it.each(['add', 'update', 'delete'] as const)('invalidates a grocery review after %s changes the plan', async (action) => {
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('test-renderer');
  const { QueryClientProvider } = await import('@tanstack/react-query');
  const hooks = await import('./useMealPlan');
  const { api } = await import('@/lib/api');
  Object.assign(api, { addMealPlanEntry: vi.fn(async () => ({ id: 'entry' })), updateMealPlanEntry: vi.fn(async () => ({})), deleteMealPlanEntry: vi.fn(async () => ({})) });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient();
  const key = mealPlanKeys.review('2026-10-26');
  client.setQueryData(key, { preview_token: 'previous' });
  let mutation: any;
  function Probe() { const add = hooks.useAddMeal(); const update = hooks.useUpdateMeal(); const remove = hooks.useDeleteMeal(); mutation = { add, update, delete: remove }[action]; return null; }
  const renderer = createRoot();
  try {
    await act(async () => renderer.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe))));
    await act(async () => mutation.mutateAsync(action === 'add' ? { date: '2026-10-26', meal_type: 'dinner', recipe_id: 'rice' } : action === 'update' ? { entryId: 'entry', update: { planned_servings: 8 } } : 'entry'));
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  } finally { await act(async () => renderer.unmount()); client.clear(); }
});

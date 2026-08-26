import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { MealPlanEntry, MealType } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    backgroundSecondary: '#fff',
    border: '#ddd',
    card: '#fafafa',
    text: '#111',
    textMuted: '#666',
    tint: '#b44',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { md: 16, sm: 14 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { full: 999, md: 12 },
  spacing: { md: 16, sm: 8, xs: 4 },
}));

import { formatMealPlanDate, RecipeMealPlanCard } from './RecipeMealPlanCard';

function entry(id: string, date: string, mealType: MealType): MealPlanEntry {
  return {
    id,
    date,
    meal_type: mealType,
    recipe_id: 'recipe-1',
    recipe_title: 'Tinaktak',
    recipe_thumbnail: null,
    notes: null,
    servings: null,
    created_at: '2026-08-26T00:00:00Z',
  };
}

describe('RecipeMealPlanCard', () => {
  it('opens an exact related date and starts a separate planning handoff', async () => {
    const onOpenDate = vi.fn();
    const onPlanRecipe = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeMealPlanCard, {
          entries: [entry('entry-1', '2026-08-27', 'dinner')],
          isLoading: false,
          onOpenDate,
          onPlanRecipe,
        }));
      });

      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      await act(async () => buttons.find(
        (button) => button.props.accessibilityLabel === 'Open meal plan for Thu, Aug 27',
      )!.props.onPress());
      await act(async () => buttons.find(
        (button) => button.props.accessibilityLabel === 'Plan this recipe',
      )!.props.onPress());

      expect(onOpenDate).toHaveBeenCalledWith('2026-08-27');
      expect(onPlanRecipe).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('formats API dates without UTC rollover', () => {
    expect(formatMealPlanDate('2026-08-27')).toBe('Thu, Aug 27');
  });

  it('shows a retryable failure instead of claiming the recipe is unplanned', async () => {
    const onRetry = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeMealPlanCard, {
          entries: [],
          isLoading: false,
          hasError: true,
          onOpenDate: vi.fn(),
          onPlanRecipe: vi.fn(),
          onRetry,
        }));
      });

      const texts = renderer.container.queryAll((instance) => instance.type === 'Text');
      expect(texts.some(
        (text) => text.props.children === "We couldn't load this recipe's upcoming plan.",
      )).toBe(true);
      expect(texts.some(
        (text) => text.props.children === 'This recipe is not on your upcoming plan yet.',
      )).toBe(false);

      const retryButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Retry loading meal plan');
      await act(async () => retryButton!.props.onPress());

      expect(onRetry).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('disables retry and shows progress while the relationship query refetches', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeMealPlanCard, {
          entries: [],
          isLoading: false,
          hasError: true,
          isRetrying: true,
          onOpenDate: vi.fn(),
          onPlanRecipe: vi.fn(),
          onRetry: vi.fn(),
        }));
      });

      const retryButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Retrying meal plan');
      expect(retryButton?.props.disabled).toBe(true);
      expect(retryButton?.props.accessibilityState).toEqual({ busy: true, disabled: true });
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Text' && instance.props.children === 'Retrying...',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'ActivityIndicator',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

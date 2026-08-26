import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { IngredientMatchResult, RecipeListItem } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    backgroundSecondary: '#eee',
    border: '#ddd',
    card: '#fff',
    cardBorder: '#ddd',
    success: '#080',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#444',
    tint: '#a43',
    warning: '#b70',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'DMSans_600SemiBold' },
  fontSize: { xs: 10, sm: 12, md: 14 },
  fontWeight: { semibold: '600' },
  radius: { md: 8, lg: 12, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16 },
}));

import { getIngredientMatchPresentation, IngredientMatchCard } from './IngredientMatchCard';

function recipe(overrides: Partial<RecipeListItem> = {}): RecipeListItem {
  return {
    id: 'recipe-1',
    title: 'Chicken Kelaguen',
    source_url: 'https://example.com/recipe',
    source_type: 'website',
    thumbnail_url: 'https://example.com/recipe.jpg',
    extraction_quality: 'high',
    has_audio_transcript: false,
    tags: [],
    servings: 4,
    total_time: '30 minutes',
    created_at: '2026-08-26T00:00:00Z',
    user_id: 'user-1',
    extractor_display_name: 'Leon',
    is_public: true,
    ...overrides,
  };
}

function result(overrides: Partial<IngredientMatchResult> = {}): IngredientMatchResult {
  return {
    recipe: recipe(),
    matched_ingredients: ['chicken', 'lemon'],
    missing_ingredients: ['green onions'],
    match_count: 2,
    total_ingredients: 3,
    match_percentage: 66.7,
    ...overrides,
  };
}

describe('getIngredientMatchPresentation', () => {
  it('distinguishes ready, nearly ready, and broader matches', () => {
    expect(getIngredientMatchPresentation(result({
      missing_ingredients: [],
      match_count: 3,
      match_percentage: 100,
    })).label).toBe('Ready to cook');
    expect(getIngredientMatchPresentation(result()).detail).toBe('1 ingredient missing');
    expect(getIngredientMatchPresentation(result({
      missing_ingredients: ['one', 'two', 'three'],
    })).label).toBe('2 of 3 matched');
  });
});

describe('IngredientMatchCard', () => {
  it('opens the exact recipe and adds its missing ingredients', async () => {
    const onOpen = vi.fn();
    const onAddMissing = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientMatchCard, {
          result: result(),
          onOpen,
          onAddMissing,
        }));
      });
      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      await act(async () => buttons.find(
        (button) => button.props.accessibilityLabel
          === 'Open Chicken Kelaguen recipe. Almost there. 1 ingredient missing',
      )!.props.onPress());
      await act(async () => buttons.find(
        (button) => button.props.accessibilityLabel
          === 'Add 1 missing ingredient from Chicken Kelaguen to grocery list',
      )!.props.onPress());

      expect(onOpen).toHaveBeenCalledOnce();
      expect(onAddMissing).toHaveBeenCalledOnce();
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image'
          && instance.props.accessibilityLabel === 'Chicken Kelaguen thumbnail',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('falls back to the placeholder when the thumbnail fails', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientMatchCard, {
          result: result(),
          onOpen: vi.fn(),
          onAddMissing: vi.fn(),
        }));
      });
      const image = renderer.container.queryAll(
        (instance) => instance.type === 'Image',
      )[0];
      await act(async () => image.props.onError());

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('does not offer grocery work when the recipe is ready to cook', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientMatchCard, {
          result: result({ missing_ingredients: [], match_count: 3, match_percentage: 100 }),
          onOpen: vi.fn(),
          onAddMissing: vi.fn(),
        }));
      });

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Text' && instance.props.children === 'Ready to cook',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel?.startsWith('Add '),
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('locks the grocery action after the ingredients were added', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientMatchCard, {
          result: result(),
          onOpen: vi.fn(),
          onAddMissing: vi.fn(),
          isAdded: true,
        }));
      });
      const addedButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel
        === 'Chicken Kelaguen missing ingredients added to grocery list');

      expect(addedButton?.props.disabled).toBe(true);
      expect(addedButton?.props.accessibilityState).toEqual({ disabled: true, busy: false });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('disables its grocery action while another result is being added', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientMatchCard, {
          result: result(),
          onOpen: vi.fn(),
          onAddMissing: vi.fn(),
          isGroceryActionDisabled: true,
        }));
      });
      const groceryButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel
        === 'Add 1 missing ingredient from Chicken Kelaguen to grocery list');

      expect(groceryButton?.props.disabled).toBe(true);
      expect(groceryButton?.props.accessibilityState).toEqual({ disabled: true, busy: false });
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { Collection } from '@/types/recipe';

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

import { RecipeCollectionsCard } from './RecipeCollectionsCard';

function collection(id: string, name: string, emoji: string | null = null): Collection {
  return {
    id,
    name,
    emoji,
    recipe_count: 1,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  };
}

describe('RecipeCollectionsCard', () => {
  it('opens exact related collections and keeps management as a separate action', async () => {
    const onOpenCollection = vi.fn();
    const onManageCollections = vi.fn();
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(RecipeCollectionsCard, {
        collections: [
          collection('favorites', 'Favorites', '❤️'),
          collection('weeknight', 'Weeknight Meals'),
        ],
        isLoading: false,
        onOpenCollection,
        onManageCollections,
      }));
    });

    const buttons = renderer!.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    );
    await act(async () => buttons.find(
      (button) => button.props.accessibilityLabel === 'Open Favorites collection',
    )!.props.onPress());
    await act(async () => buttons.find(
      (button) => button.props.accessibilityLabel === 'Manage recipe collections',
    )!.props.onPress());

    expect(onOpenCollection).toHaveBeenCalledWith('favorites');
    expect(onManageCollections).toHaveBeenCalledOnce();
  });

  it('offers an add action when the recipe has no collection relationships', async () => {
    const onManageCollections = vi.fn();
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(RecipeCollectionsCard, {
        collections: [],
        isLoading: false,
        onOpenCollection: vi.fn(),
        onManageCollections,
      }));
    });

    const addButton = renderer!.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    ).find((button) => button.props.accessibilityLabel === 'Add recipe to a collection');
    await act(async () => addButton!.props.onPress());

    expect(onManageCollections).toHaveBeenCalledOnce();
  });
});

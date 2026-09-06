import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { RecipeListItem } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Chip: 'Chip',
  Text: 'Text',
  View: 'View',
  useColors: () => ({
    background: '#fff', border: '#ddd', card: '#fff', cardBorder: '#ddd',
    text: '#111', textMuted: '#666', tint: '#155c52', warning: '#8a5a00',
  }),
}));
vi.mock('@/hooks/useRecipes', () => ({
  useInfiniteDiscoverRecipes: vi.fn(), usePopularTags: vi.fn(),
  useRecipes: vi.fn(), useSavedRecipes: vi.fn(),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { full: 999, md: 12, lg: 16 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/utils/haptics', () => ({ lightHaptic: vi.fn() }));
vi.mock('@/components/RecipeTrustBadge', async () => {
  const ReactModule = await import('react');
  return {
    RecipeTrustBadge: ({ reviewState }: { reviewState?: string }) => {
      const label = reviewState === 'needs_review'
        ? 'Recipe needs review'
        : reviewState === 'source_incomplete'
          ? 'Recipe needs source details'
          : null;
      return label
        ? ReactModule.createElement('RecipeTrustBadge', { accessibilityLabel: label })
        : null;
    },
  };
});

import { RecipePickerRow } from './RecipePickerModal';

const colors = {
  background: '#fff', border: '#ddd', card: '#fff', cardBorder: '#ddd',
  text: '#111', textMuted: '#666', tint: '#155c52', warning: '#8a5a00',
} as any;

function recipe(
  reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined,
): RecipeListItem {
  return {
    id: 'recipe-1',
    title: 'Chicken Kelaguen',
    source_url: 'https://example.com/recipe',
    source_type: 'website',
    thumbnail_url: null,
    extraction_quality: null,
    has_audio_transcript: false,
    tags: [],
    servings: null,
    total_time: null,
    created_at: '2026-09-06T00:00:00Z',
    user_id: 'stable-app-user',
    extractor_display_name: 'Cook',
    is_public: false,
    review_state: reviewState,
  };
}

async function renderRow(reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => {
    renderer.render(React.createElement(RecipePickerRow, {
      item: recipe(reviewState),
      colors,
      onPress: vi.fn(),
    }));
  });
  return renderer;
}

describe('recipe picker readiness', () => {
  it.each([
    ['needs_review', 'Recipe needs review'],
    ['source_incomplete', 'Recipe needs source details'],
  ] as const)('renders %s on recipe choices', async (state, label) => {
    const renderer = await renderRow(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === label,
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it.each(['ready', undefined] as const)('hides a badge for %s recipes', async (state) => {
    const renderer = await renderRow(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel?.startsWith('Recipe needs'),
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecipeListItem } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Dimensions: { get: () => ({ width: 390 }) },
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn() },
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
  TouchableOpacity: 'TouchableOpacity',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  View: 'View',
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'viewer-1', isSignedIn: true }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Button: 'Button',
  Chip: 'Chip',
  Input: 'Input',
  Text: 'Text',
  View: 'View',
  useColors: () => colors,
}));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: 'SignInBanner' }));
vi.mock('@/components/FilterBottomSheet', () => ({ default: 'FilterBottomSheet' }));
vi.mock('@/components/CreateCollectionModal', () => ({ default: 'CreateCollectionModal' }));
vi.mock('@/components/BulkAddToCollectionModal', () => ({ default: 'BulkAddToCollectionModal' }));
vi.mock('@/components/Skeleton', () => ({
  SkeletonCollectionList: 'SkeletonCollectionList',
  SkeletonRecipeList: 'SkeletonRecipeList',
}));
vi.mock('@/components/Animated', () => ({
  AnimatedListItem: 'AnimatedListItem',
  ScalePressable: 'ScalePressable',
}));
const library = vi.hoisted(() => ({
  filters: {} as Record<string, unknown>,
  search: [] as RecipeListItem[],
  cached: [] as RecipeListItem[],
  moreSearch: vi.fn(), moreSaved: vi.fn(), moreOwn: vi.fn(),
  hasMoreSearch: false,
}));
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({ recipes: [], total: 0, fetchNextPage: library.moreOwn, hasNextPage: true }),
  useSavedRecipes: () => ({ recipes: library.cached, fetchNextPage: library.moreSaved, hasNextPage: true }),
  useSearchRecipes: (filters: Record<string, unknown>) => {
    library.filters = filters;
    return { recipes: library.search, total: library.search.length, isSuccess: true,
      hasNextPage: library.hasMoreSearch, fetchNextPage: library.moreSearch };
  },
  useRecipeCount: () => ({ data: { count: 0 } }),
  usePopularTags: () => ({ data: [] }),
}));
vi.mock('@/hooks/useCollections', () => ({ useCollections: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/useViewPreference', () => ({ useViewPreference: () => ({ viewMode: 'list', isGrid: false }) }));
vi.mock('@/hooks/usePullToRefresh', () => ({ usePullToRefresh: () => ({ isPullRefreshing: false, onPullRefresh: vi.fn() }) }));
vi.mock('@/hooks/useDebouncedSearchQuery', () => ({ useDebouncedSearchQuery: (value: string) => value }));
vi.mock('@/constants/Colors', () => ({
  default: { light: {}, dark: {} },
  fontFamily: { semibold: 'System' },
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18, xl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { full: 999, sm: 8, md: 12, lg: 16 },
  shadows: { sm: {} },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/utils/haptics', () => ({ haptics: {} }));
vi.mock('@/lib/recipeSource', () => ({
  getRecipeSourcePresentation: () => ({ icon: 'link-outline', label: 'Website' }),
}));
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

import HistoryScreen, { GridRecipeCard, RecipeCard } from '../app/(tabs)/history';

const colors = {
  card: '#fff', cardBorder: '#ddd', error: '#b00', success: '#070', text: '#111',
  textMuted: '#666', textSecondary: '#444', tint: '#155c52', warning: '#8a5a00',
} as any;

beforeEach(() => {
  library.filters = {}; library.search = []; library.cached = []; library.hasMoreSearch = false;
  library.moreSearch.mockClear(); library.moreSaved.mockClear(); library.moreOwn.mockClear();
});

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
    meal_types: [],
    servings: null,
    total_time: null,
    created_at: '2026-09-06T00:00:00Z',
    user_id: null,
    extractor_display_name: null,
    is_public: false,
    review_state: reviewState,
  };
}

async function renderCard(
  Card: typeof RecipeCard | typeof GridRecipeCard,
  reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined,
) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => {
    renderer.render(React.createElement(Card, {
      recipe: recipe(reviewState),
      colors,
      onPress: vi.fn(),
      isSavedRecipe: false,
    }));
  });
  return renderer;
}

describe.each([
  ['list', RecipeCard],
  ['grid', GridRecipeCard],
] as const)('History %s recipe readiness', (_variant, Card) => {
  it.each([
    ['needs_review', 'Recipe needs review'],
    ['source_incomplete', 'Recipe needs source details'],
  ] as const)('renders %s', async (state, label) => {
    const renderer = await renderCard(Card, state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === label,
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it.each(['ready', undefined] as const)('hides a badge for %s recipes', async (state) => {
    const renderer = await renderCard(Card, state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel?.startsWith('Recipe needs'),
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

describe('Saved library search', () => {
  it.each([false, true])('uses authoritative saved results, including an empty page (%s)', async empty => {
    library.cached = [{ ...recipe('ready'), id: 'cached-match', title: 'Rice from cached page' }];
    library.search = empty ? [] : [{ ...recipe('ready'), id: 'older-saved-match', title: 'Rice outside cached page' }];
    library.hasMoreSearch = !empty;
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(HistoryScreen)));
      await act(async () => {
        renderer.container.queryAll(instance => instance.type === 'FilterBottomSheet')[0].props.onOwnershipFilterChange('saved');
        renderer.container.queryAll(instance => instance.type === 'Input')[0].props.onChangeText('Rice');
      });
      expect(library.filters).toMatchObject({ ownership: 'saved', query: 'Rice' });
      const list = renderer.container.queryAll(instance => instance.type === 'FlatList')[0];
      expect(list.props.data).toEqual(library.search);
      if (!empty) {
        const footer = createRoot({ textComponentTypes: ['Text'] });
        try {
          await act(async () => footer.render(React.createElement(list.props.ListFooterComponent)));
          await act(async () => footer.container.queryAll(instance => instance.type === 'TouchableOpacity')[0].props.onPress());
        } finally { await act(async () => footer.unmount()); }
        expect(library.moreSearch).toHaveBeenCalledOnce();
        expect(library.moreSaved).not.toHaveBeenCalled();
        expect(library.moreOwn).not.toHaveBeenCalled();
      }
    } finally { await act(async () => renderer.unmount()); }
  });
});

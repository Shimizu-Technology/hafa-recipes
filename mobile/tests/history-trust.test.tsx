import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Collection, RecipeListItem } from '@/types/recipe';

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
  useAuth: () => ({ userId: 'viewer-1', isSignedIn: library.signedIn }),
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
  signedIn: true,
  isGrid: false,
  collections: {
    data: [] as Collection[] | undefined,
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  },
  refetchRecipes: vi.fn(), refetchSaved: vi.fn(),
}));
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: () => ({ recipes: [], total: 0, fetchNextPage: library.moreOwn, hasNextPage: true, refetch: library.refetchRecipes }),
  useSavedRecipes: () => ({ recipes: library.cached, fetchNextPage: library.moreSaved, hasNextPage: true, refetch: library.refetchSaved }),
  useSearchRecipes: (filters: Record<string, unknown>) => {
    library.filters = filters;
    return { recipes: library.search, total: library.search.length, isSuccess: true,
      hasNextPage: library.hasMoreSearch, fetchNextPage: library.moreSearch };
  },
  useRecipeCount: () => ({ data: { count: 0 } }),
  usePopularTags: () => ({ data: [] }),
}));
vi.mock('@/hooks/useCollections', () => ({ useCollections: () => library.collections }));
vi.mock('@/hooks/useViewPreference', () => ({
  useViewPreference: () => ({ viewMode: library.isGrid ? 'grid' : 'list', isGrid: library.isGrid }),
}));
vi.mock('@/hooks/usePullToRefresh', () => ({ usePullToRefresh: (refresh: () => Promise<unknown>) => ({ isPullRefreshing: false, onPullRefresh: refresh }) }));
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
  library.signedIn = true;
  library.isGrid = false;
  Object.assign(library.collections, { data: [], isLoading: false, isError: false, isFetching: false });
  library.collections.refetch.mockClear(); library.refetchRecipes.mockClear(); library.refetchSaved.mockClear();
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

describe('Library card VoiceOver focus', () => {
  it.each([false, true])('focuses the labelled card, not its long-press wrapper (grid: %s)', async (isGrid) => {
    library.isGrid = isGrid;
    library.cached = [recipe('needs_review')];
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    const row = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(HistoryScreen)));
      const list = renderer.container.queryAll(instance => instance.type === 'FlatList')[0];
      await act(async () => row.render(list.props.renderItem({ item: library.cached[0], index: 0 })));

      const wrapper = row.container.queryAll(instance => instance.type === 'TouchableOpacity' && !!instance.props.onLongPress)[0];
      expect(wrapper.props.accessible).toBe(false);
      const card = row.container.queryAll(instance => instance.type === 'ScalePressable')[0];
      expect(card.props.accessibilityRole).toBe('button');
      expect(card.props.accessibilityLabel).toBe(
        'Chicken Kelaguen, Some recipe details are uncertain, Website, Saved',
      );
      expect(card.props.accessibilityState).toBeUndefined();
    } finally {
      await act(async () => row.unmount());
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
      if (empty) {
        const emptyView = createRoot({ textComponentTypes: ['Text'] });
        try {
          await act(async () => emptyView.render(React.createElement(list.props.ListEmptyComponent)));
          expect(emptyView.container.queryAll(instance => instance.props.children === 'No recipes match')).toHaveLength(1);
          expect(emptyView.container.queryAll(instance => instance.props.children === 'Add Your First Recipe')).toHaveLength(0);
          await act(async () => emptyView.container.queryAll(instance => instance.type === 'TouchableOpacity')[0].props.onPress());
          expect(renderer.container.queryAll(instance => instance.type === 'Input')[0].props.value).toBe('');
          expect(renderer.container.queryAll(instance => instance.type === 'FilterBottomSheet')[0].props.ownershipFilter).toBe('all');
          expect(library.filters.query).toBe('');
          expect(library.filters.ownership).toBe('all');
          expect(renderer.container.queryAll(instance => instance.type === 'FlatList')[0].props.data).toEqual(library.cached);
        } finally { await act(async () => emptyView.unmount()); }
      }
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

describe('Library collection recovery', () => {
  beforeEach(() => {
    Object.assign(library.collections, { data: undefined, isError: true });
  });

  async function renderLibrary() {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    await act(async () => { renderer.render(<HistoryScreen />); });
    return renderer;
  }

  it('offers an explicit retry after the initial collection request fails', async () => {
    const renderer = await renderLibrary();
    try {
      expect(renderer.container.queryAll(instance =>
        instance.props.children === 'Couldn’t load your collections. Check your connection and try again.',
      )).toHaveLength(1);
      const retry = renderer.container.queryAll(instance => instance.props.title === 'Try again')[0];
      await act(async () => { retry.props.onPress(); });
      expect(library.collections.refetch).toHaveBeenCalledOnce();
    } finally { await act(async () => renderer.unmount()); }
  });

  it('retains cached collection cards and disables retry while reconnecting', async () => {
    library.collections.data = [{ id: 'collection-1', name: 'Weeknight dinners', recipe_count: 1 } as Collection];
    library.collections.isFetching = true;
    const renderer = await renderLibrary();
    try {
      expect(renderer.container.queryAll(instance => instance.props.children === 'Weeknight dinners')).toHaveLength(1);
      expect(renderer.container.queryAll(instance =>
        instance.props.children === 'Couldn’t refresh your collections. Your last loaded collections are still shown.',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(instance => instance.props.title === 'Trying again…')[0].props.disabled).toBe(true);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('keeps creation available without claiming the failed cached list is empty', async () => {
    library.collections.data = [];
    const renderer = await renderLibrary();
    try {
      expect(renderer.container.queryAll(instance =>
        instance.props.children === 'Create your first collection to organize recipes',
      )).toHaveLength(0);
      const create = renderer.container.queryAll(instance => instance.props.title === 'New collection')[0];
      await act(async () => { create.props.onPress(); });
      expect(renderer.container.queryAll(instance => instance.type === 'CreateCollectionModal')[0].props.visible).toBe(true);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('includes collections in the normal Library pull to refresh', async () => {
    const renderer = await renderLibrary();
    try {
      const list = renderer.container.queryAll(instance => instance.type === 'FlatList')[0];
      await act(async () => { await list.props.refreshControl.props.onRefresh(); });
      expect(library.collections.refetch).toHaveBeenCalledOnce();
      expect(library.refetchRecipes).toHaveBeenCalledOnce();
      expect(library.refetchSaved).toHaveBeenCalledOnce();
    } finally { await act(async () => renderer.unmount()); }
  });

  it('does not display collection errors or refetch collections for a guest', async () => {
    library.signedIn = false;
    const renderer = await renderLibrary();
    try {
      expect(renderer.container.queryAll(instance => instance.props.accessibilityRole === 'alert')).toHaveLength(0);
      const list = renderer.container.queryAll(instance => instance.type === 'FlatList')[0];
      await act(async () => { await list.props.refreshControl.props.onRefresh(); });
      expect(library.collections.refetch).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); }
  });
});

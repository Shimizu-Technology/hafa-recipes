vi.mock('@/components/LibraryStatus', () => ({ LibraryStatus: 'LibraryStatus' }));
vi.mock('@/components/RecipeBrowseHeader', () => ({ RecipeBrowseHeader: ({ actions }: any) => <>{actions.map((action: any) => React.createElement('button', { key: action.title, accessibilityLabel: action.title, onPress: action.onPress }))}</>, showBrowseMenu: vi.fn() }));
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
  useWindowDimensions: () => ({ width: 390, fontScale: library.fontScale }),
  TouchableOpacity: 'TouchableOpacity',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  View: 'View',
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
  Stack: { Screen: 'StackScreen' },
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
  useInitialListEntrance: () => () => false,
}));
const library = vi.hoisted(() => ({
  filters: {} as Record<string, unknown>,
  search: [] as RecipeListItem[],
  cached: [] as RecipeListItem[],
  moreSearch: vi.fn(), moreSaved: vi.fn(), moreOwn: vi.fn(),
  hasMoreSearch: false,
  ownTotal: 0,
  savedTotal: undefined as number | undefined,
  searchTotal: undefined as number | undefined,
  signedIn: true,
  fontScale: 1,
  isGrid: false,
  collections: {
    data: [] as Collection[] | undefined,
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  },
  refetchRecipes: vi.fn(), refetchSaved: vi.fn(),
}));
vi.mock('@/hooks/useRecipes', () => ({
  useRecipes: (sourceType?: string) => ({ recipes: [], total: sourceType ? 10 : library.ownTotal, fetchNextPage: library.moreOwn, hasNextPage: true, refetch: library.refetchRecipes }),
  useSavedRecipes: () => ({ recipes: library.cached, total: library.savedTotal ?? library.cached.length, fetchNextPage: library.moreSaved, hasNextPage: true, refetch: library.refetchSaved }),
  useSearchRecipes: (filters: Record<string, unknown>) => {
    library.filters = filters;
    return { recipes: library.search, total: library.searchTotal ?? library.search.length, isSuccess: true,
      hasNextPage: library.hasMoreSearch, fetchNextPage: library.moreSearch };
  },
  useRecipeCount: (sourceType?: string) => ({ data: { count: sourceType ? 10 : library.ownTotal } }),
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
vi.mock('@/utils/haptics', () => ({ haptics: { light: vi.fn(), medium: vi.fn() } }));
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

import CollectionsScreen from '../app/collections';
import { HistoryScreen, GridRecipeCard, RecipeCard } from '../app/history';

const colors = {
  card: '#fff', cardBorder: '#ddd', error: '#b00', success: '#070', text: '#111',
  textMuted: '#666', textSecondary: '#444', tint: '#155c52', warning: '#8a5a00',
} as any;

beforeEach(() => {
  library.filters = {}; library.search = []; library.cached = []; library.hasMoreSearch = false;
  library.savedTotal = undefined;
  library.ownTotal = 0; library.searchTotal = undefined;
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
        (instance) => instance.type === 'ScalePressable' && instance.props.accessibilityLabel?.includes(state === 'needs_review' ? 'Some recipe details are uncertain' : 'Recipe needs source details'),
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

describe('Saved library filtering', () => {
  it.each([true, false])('announces the server saved state outside the cached saved page (%s)', async isSaved => {
    const item = { ...recipe('ready'), id: 'outside-page', is_saved: isSaved };
    library.cached = isSaved ? [] : [item];
    const screen = createRoot();
    const row = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => screen.render(<HistoryScreen />));
      const list = screen.container.queryAll(node => node.type === 'FlatList')[0];
      await act(async () => row.render(list.props.renderItem({ item, index: 0 })));
      const card = row.container.queryAll(node => node.type === 'ScalePressable')[0];
      expect(card.props.accessibilityLabel.endsWith(', Saved')).toBe(isSaved);
    } finally {
      await act(async () => row.unmount());
      await act(async () => screen.unmount());
    }
  });

  it.each([false, true])('uses authoritative saved results, including an empty page (%s)', async empty => {
    library.cached = [{ ...recipe('ready'), id: 'cached-match', title: 'Rice from cached page' }];
    library.search = empty ? [] : [{ ...recipe('ready'), id: 'older-saved-match', title: 'Rice outside cached page' }];
    library.hasMoreSearch = !empty;
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(HistoryScreen)));
      await act(async () => {
        renderer.container.queryAll(instance => instance.type === 'FilterBottomSheet')[0].props.onApply({ sourceFilter: 'website', timeFilter: 'all', selectedTags: [], ownershipFilter: 'saved' });
      });
      expect(library.filters).toMatchObject({ ownership: 'saved', sourceType: 'website' });
      const list = renderer.container.queryAll(instance => instance.type === 'FlatList')[0];
      expect(list.props.data).toEqual(library.search);
      if (empty) {
        const emptyView = createRoot({ textComponentTypes: ['Text'] });
        try {
          await act(async () => emptyView.render(React.createElement(list.props.ListEmptyComponent)));
          expect(emptyView.container.queryAll(instance => instance.props.children === 'No recipes match')).toHaveLength(1);
          expect(emptyView.container.queryAll(instance => instance.props.children === 'Add Your First Recipe')).toHaveLength(0);
          await act(async () => emptyView.container.queryAll(instance => instance.type === 'TouchableOpacity')[0].props.onPress());
          expect(renderer.container.queryAll(instance => instance.type === 'FilterBottomSheet')[0].props.initialFilters.ownershipFilter).toBe('all');
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

describe('Library shown selection', () => {
  it('selects the displayed page without claiming the full server library', async () => {
    library.ownTotal = 100;
    library.cached = Array.from({ length: 25 }, (_, i) => ({ ...recipe('ready'), id: `saved-${i}` }));
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    await act(async () => renderer.render(<HistoryScreen />));
    await act(async () => renderer.container.queryAll(n => n.props.accessibilityLabel === 'Select recipes')[0].props.onPress());
    const header = createRoot({ textComponentTypes: ['Text'] });
    await act(async () => header.render(renderer.container.queryAll(n => n.type === 'FlatList')[0].props.ListHeaderComponent));
    const select = header.container.queryAll(n => n.type === 'TouchableOpacity' && n.children.some(c => typeof c !== 'string' && c.props.children === 'Select shown'))[0];
    await act(async () => select.props.onPress());
    await act(async () => header.render(renderer.container.queryAll(n => n.type === 'FlatList')[0].props.ListHeaderComponent));
    const bulk = renderer.container.queryAll(n => n.type === 'BulkAddToCollectionModal')[0];
    expect(bulk.props.recipeIds).toHaveLength(20);
    expect(header.container.queryAll(n => n.props.children === 'Deselect all')).toHaveLength(1);
    await act(async () => header.unmount());
    await act(async () => renderer.unmount());
  });
});

describe('Library count removal', () => {
  const countText = (renderer: ReturnType<typeof createRoot>) =>
    renderer.container.queryAll(instance => instance.type === 'Text' && /^\d+( of \d+)? recipes?$/.test(String(instance.props.children)))
      .map(instance => instance.props.children);

  it('omits the count row when a source narrows the matches', async () => {
    library.ownTotal = 100; library.savedTotal = 72; library.searchTotal = 17;
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<HistoryScreen />));
      const sheet = renderer.container.queryAll(n => n.type === 'FilterBottomSheet')[0];
      await act(async () => sheet.props.onApply({ sourceFilter: 'tiktok', timeFilter: 'all', selectedTags: [], ownershipFilter: 'all' }));
      expect(countText(renderer)).toEqual([]);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('omits counts for the full library and saved-only view', async () => {
    library.ownTotal = 100; library.savedTotal = 72;
    library.cached = [recipe('ready')];
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<HistoryScreen />));
      expect(countText(renderer)).toEqual([]);
      await act(async () => renderer.container.queryAll(n => n.type === 'FilterBottomSheet')[0].props.onApply({ sourceFilter: 'all', timeFilter: 'all', selectedTags: [], ownershipFilter: 'saved' }));
      expect(countText(renderer)).toEqual([]);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('omits count rows while paginating filtered results', async () => {
    library.ownTotal = 100;
    library.searchTotal = 37;
    // Only the first page of matches is loaded; the count must not use its length.
    library.search = Array.from({ length: 20 }, (_, index) => ({ ...recipe('ready'), id: `match-${index}` }));
    library.hasMoreSearch = true;
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(HistoryScreen)));
      expect(countText(renderer)).toEqual([]);
      await act(async () => {
        renderer.container.queryAll(instance => instance.type === 'FilterBottomSheet')[0].props.onApply({ sourceFilter: 'website', timeFilter: 'all', selectedTags: [], ownershipFilter: 'all' });
      });
      expect(countText(renderer)).toEqual([]);
    } finally { await act(async () => renderer.unmount()); }
  });
});

describe('Library collection recovery', () => {
  beforeEach(() => {
    Object.assign(library.collections, { data: undefined, isError: true });
  });

  async function renderLibrary(collections = false) {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    await act(async () => { renderer.render(collections ? <CollectionsScreen /> : <HistoryScreen />); });
    return renderer;
  }

  it('offers an explicit retry after the initial collection request fails', async () => {
    const renderer = await renderLibrary(true);
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
    const renderer = await renderLibrary(true);
    try {
      expect(renderer.container.queryAll(instance => instance.props.children === 'Weeknight dinners')).toHaveLength(1);
      expect(renderer.container.queryAll(instance => instance.props.accessibilityLabel === 'Weeknight dinners, 1 recipe').length).toBeGreaterThan(0);
      expect(renderer.container.queryAll(instance =>
        instance.props.children === 'Couldn’t refresh your collections. Your last loaded collections are still shown.',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(instance => instance.props.title === 'Trying again…')[0].props.disabled).toBe(true);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('keeps creation available without claiming the failed cached list is empty', async () => {
    library.collections.data = [];
    const renderer = await renderLibrary(true);
    try {
      expect(renderer.container.queryAll(instance =>
        instance.props.children === 'Create your first collection to organize recipes',
      )).toHaveLength(0);
      const create = renderer.container.queryAll(instance => instance.props.title === 'New collection')[0];
      await act(async () => { create.props.onPress(); });
      expect(renderer.container.queryAll(instance => instance.type === 'CreateCollectionModal')[0].props.visible).toBe(true);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('refreshes Library recipes without fetching the separate Collections screen', async () => {
    const renderer = await renderLibrary();
    try {
      const list = renderer.container.queryAll(instance => instance.type === 'FlatList')[0];
      await act(async () => { await list.props.refreshControl.props.onRefresh(); });
      expect(library.collections.refetch).not.toHaveBeenCalled();
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


describe('Library browse controls', () => {
  it('keeps search and count rows out of Library and opens the existing filter sheet', async () => {
    const renderer = createRoot();
    const header = createRoot();
    try {
      await act(async () => renderer.render(<HistoryScreen />));
      expect(renderer.container.queryAll(n => n.type === 'Input')).toHaveLength(0);
      const list = () => renderer.container.queryAll(n => n.type === 'FlatList')[0];
      await act(async () => header.render(list().props.ListHeaderComponent));
      const links = header.container.queryAll(n => n.type === 'LibraryStatus')[0];
      await act(async () => links.props.onFilter());
      const sheet = () => renderer.container.queryAll(n => n.type === 'FilterBottomSheet')[0];
      expect(sheet().props.visible).toBe(true);
      await act(async () => sheet().props.onApply({ sourceFilter: 'manual', timeFilter: 'quick', selectedTags: ['dinner'], ownershipFilter: 'saved' }));
      await act(async () => header.render(list().props.ListHeaderComponent));
      expect(header.container.queryAll(n => n.props.accessibilityLabel === 'Clear library filters')).toHaveLength(1);
      await act(async () => header.container.queryAll(n => n.props.accessibilityLabel === 'Clear library filters')[0].props.onPress());
      expect(sheet().props.initialFilters).toMatchObject({ sourceFilter: 'all', timeFilter: 'all', selectedTags: [], ownershipFilter: 'all' });
    } finally { await act(async () => header.unmount()); await act(async () => renderer.unmount()); }
  });
  it('filters the loaded library to recipes needing a check', async () => {
    library.cached = [{ ...recipe('ready'), id: 'ready' }, recipe('needs_review')];
    const renderer = createRoot(), header = createRoot();
    try {
      await act(async () => renderer.render(<HistoryScreen />));
      const list = () => renderer.container.queryAll(n => n.type === 'FlatList')[0];
      await act(async () => header.render(list().props.ListHeaderComponent));
      const links = header.container.queryAll(n => n.type === 'LibraryStatus')[0];
      expect(links.props.needsCheck).toBe(1);
      await act(async () => links.props.onNeedsCheck());
      expect(list().props.data.map((r: any) => r.id)).toEqual(['recipe-1']);
    } finally { await act(async () => header.unmount()); await act(async () => renderer.unmount()); }
  });
});

it('uses a single column at the updated accessibility threshold', async () => {
  library.isGrid = true; library.fontScale = 1.3;
  const renderer = createRoot();
  try {
    await act(async () => renderer.render(<HistoryScreen />));
    const list = renderer.container.queryAll(n => n.type === 'FlatList')[0];
    expect(list.props.numColumns).toBe(1);
    expect(list.props.columnWrapperStyle).toBeUndefined();
  } finally { library.fontScale = 1; await act(async () => renderer.unmount()); }
});

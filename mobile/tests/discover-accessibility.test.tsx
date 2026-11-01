vi.mock('@/components/chrome/SearchLauncher', () => ({ SearchLauncher: 'SearchLauncher' }));
vi.mock('@/components/RecipeBrowseHeader', () => ({ RecipeBrowseHeader: ({ actions }: any) => <>{actions.map((action: any) => React.createElement('button', { key: action.title, accessibilityLabel: action.title, onPress: action.onPress }))}</>, showBrowseMenu: vi.fn() }));
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  signedIn: true, searching: false, focused: true, feedEnabled: false,
  push: vi.fn(),
  save: vi.fn(), unsave: vi.fn(),
  searchArgs: [] as unknown[],
}));

vi.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mocks.focused }));
vi.mock('@/hooks/useOfflineLease', () => ({ useRecipeOwnerGeneration: () => 1 }));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host('ActivityIndicator'),
    useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
    Alert: { alert: vi.fn() },
    FlatList: (props: any) => ReactModule.createElement('FlatList', props, props.ListHeaderComponent),
    Keyboard: { dismiss: vi.fn() },
    Modal: host('Modal'),
    Platform: { OS: 'ios' },
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    TouchableOpacity: host('TouchableOpacity'),
    TouchableWithoutFeedback: host('TouchableWithoutFeedback'),
    View: host('NativeView'),
  };
});
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: mocks.signedIn ? 'user-1' : null, isSignedIn: mocks.signedIn }) }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Chip: host('Chip'),
    Input: host('Input'),
    Text: host('ThemedText'),
    View: host('ThemedView'),
    useColors: () => ({
      background: '#fff',
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      card: '#fff',
      text: '#111',
      textMuted: '#666',
      textSecondary: '#555',
      tint: '#155c52',
      warning: '#f90',
    }),
  };
});
vi.mock('@/constants/Colors', () => ({
  fontFamily: { displaySemibold: 'Fraunces', medium: 'DMSans', regular: 'DMSans' },
  fontSize: { xs: 11, sm: 13, md: 15, lg: 18, xl: 20, xxl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { sm: 4, md: 14, lg: 20, xl: 28, full: 9999 },
  shadows: { sm: {}, md: {}, lg: {} },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: () => null }));
vi.mock('@/components/AllContributorsModal', () => ({ default: (props: any) => React.createElement('AllContributorsModal', props) }));
vi.mock('@/components/Skeleton', () => ({ SkeletonRecipeList: () => null }));
vi.mock('@/components/Animated', () => ({ AnimatedListItem: () => null, ScalePressable: 'TouchableOpacity', useInitialListEntrance: () => () => false }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: () => null }));
vi.mock('@/components/RecipeGridCardFrame', () => ({ RecipeGridCardFrame: () => null, RECIPE_GRID_GAP: 8 }));
vi.mock('react-native-reanimated', () => ({
  default: { View: () => null },
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: unknown) => ({ value }),
  withSequence: vi.fn(),
  withSpring: vi.fn(),
}));
vi.mock('@/utils/haptics', () => ({ haptics: { light: vi.fn(), medium: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/api', () => ({ api: { getRandomRecipe: vi.fn() } }));
vi.mock('@/lib/recipeSource', () => ({ getRecipeSourcePresentation: () => ({ label: 'Website', icon: 'globe-outline' }) }));
vi.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ isPullRefreshing: false, onPullRefresh: vi.fn() }),
}));
vi.mock('@/hooks/useViewPreference', async () => {
  const ReactModule = await import('react');
  return {
    useViewPreference: () => {
      const [viewMode, setViewMode] = ReactModule.useState<'grid' | 'list'>('grid');
      return {
        viewMode,
        isGrid: viewMode === 'grid',
        toggleViewMode: () => setViewMode((mode) => (mode === 'grid' ? 'list' : 'grid')),
      };
    },
  };
});
vi.mock('@/hooks/useRecipes', () => {
  const page = {
    recipes: [],
    total: 0,
    isLoading: true,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isError: false,
  };
  return {
    useCurrentUserIdentity: () => ({ data: { id: 'app-user-1' } }),
    useDiscoverRecipes: (_source: unknown, enabled: boolean) => { mocks.feedEnabled = enabled; return page; },
    useSearchPublicRecipes: (args: unknown) => {
      mocks.searchArgs.push(args);
      return { ...page, isLoading: false, isFetching: mocks.searching, isSuccess: true };
    },
    usePublicRecipeCount: () => ({ data: { count: 12 } }),
    useIsRecipeSaved: () => ({ data: false }),
    useSaveRecipe: () => ({ mutate: mocks.save }),
    useUnsaveRecipe: () => ({ mutate: mocks.unsave }),
    usePopularTags: () => ({ data: [] }),
    useTopContributors: () => ({ data: [{ user_id: 'maria', contributor_id: 'maria', display_name: 'Maria', recipe_count: 1 }] }),
    filterRecipesLocally: () => [],
  };
});

import { guestRecipeIntent } from '../lib/guestRecipeIntent';
import DiscoverRoute, { SaveButton } from '../app/(tabs)/discover';
import { DiscoverScreen } from '../app/(tabs)/discover';
import FilterBottomSheet from '../components/FilterBottomSheet';
import { api } from '@/lib/api';

function textOf(node: ReactTestInstance | string | number): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node.children.map(textOf).join('');
}

function touchables(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType);
}

function byLabel(renderer: ReactTestRenderer, label: string) {
  return touchables(renderer).find((node) => node.props.accessibilityLabel === label);
}

function byText(renderer: ReactTestRenderer, text: string) {
  return touchables(renderer).find((node) => textOf(node) === text)!;
}

const SOURCE_LABELS = ['All Sources', 'TikTok', 'YouTube', 'Instagram', 'Website', 'Manual'];

describe('Discover accessibility', () => {
  beforeEach(() => {
    mocks.searchArgs = [];
  });

  it('keeps a single Surprise request in flight and shows progress until navigation', async () => {
    let finish!: (recipe: any) => void;
    vi.mocked(api.getRandomRecipe).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    mocks.push.mockClear();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<DiscoverScreen />); });
    try {
      await act(async () => renderer.root.findAllByType('button' as any).find(n => n.props.accessibilityLabel === 'Surprise me')!.props.onPress());
      const option = byText(renderer, 'Random Dinner');
      await act(async () => { void option.props.onPress(); void option.props.onPress(); });
      expect(api.getRandomRecipe).toHaveBeenCalledOnce();
      expect(renderer.root.findAllByType('ActivityIndicator' as any).some(n => n.props.accessibilityLabel === 'Finding a recipe')).toBe(true);
      await act(async () => { finish({ id: 'random-one' }); });
      expect(mocks.push.mock.calls).toEqual([['/recipe/random-one']]);
      expect(renderer.root.findAllByType('ActivityIndicator' as any).some(n => n.props.accessibilityLabel === 'Finding a recipe')).toBe(false);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('keeps Discover as a grid and exposes unique actions through the header menu', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<DiscoverScreen />); });
    try {
      expect(renderer.root.findAllByType('Input' as any)).toHaveLength(0);
      expect(byLabel(renderer, 'Show recipes as a list')).toBeUndefined();
      const filter = renderer.root.findAllByType('button' as any).find(n => n.props.accessibilityLabel === 'Filter recipes')!;
      await act(async () => filter.props.onPress());
      await act(async () => byText(renderer, 'YouTube').props.onPress());
      expect(byText(renderer, 'YouTube').props.accessibilityState).toEqual({ selected: true, checked: true });
      await act(async () => byText(renderer, 'Apply (1)').props.onPress());
      expect(mocks.searchArgs.at(-1)).toEqual(expect.objectContaining({ sourceType: 'youtube' }));
      expect(renderer.root.findAllByType('button' as any).map(n => n.props.accessibilityLabel)).toEqual(['Filter recipes', 'Top contributors', 'Surprise me', 'Search by ingredient']);
      await act(async () => renderer.root.findAllByType('button' as any).find(n => n.props.accessibilityLabel === 'Top contributors')!.props.onPress());
      const contributors = renderer.root.findByType('AllContributorsModal' as any);
      expect(contributors.props.visible).toBe(true);
      await act(async () => contributors.props.onSelectContributor({ contributor_id: 'maria', display_name: 'Maria' }));
      expect(mocks.searchArgs.at(-1)).toEqual(expect.objectContaining({ extractorId: 'maria', extractorName: 'Maria' }));
    } finally { await act(async () => renderer.unmount()); }
  });
});

describe('FilterBottomSheet accessibility', () => {
  async function renderSheet(sourceFilter: 'all' | 'tiktok' = 'all') {
    const onApply = vi.fn();
    const onClose = vi.fn();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <FilterBottomSheet
          visible
          onClose={onClose}
          onApply={onApply}
          initialFilters={{ sourceFilter, timeFilter: 'all', selectedTags: [] }}
        />,
      );
    });
    return { renderer: renderer!, onApply, onClose };
  }

  it('exposes every source filter as a radio with its selected state', async () => {
    const { renderer } = await renderSheet('tiktok');

    for (const label of SOURCE_LABELS) {
      const chip = byText(renderer, label);
      expect(chip.props.accessibilityRole, label).toBe('radio');
      expect(chip.props.accessibilityState, label).toEqual({ selected: label === 'TikTok', checked: label === 'TikTok' });
    }
  });

  it('moves the selected state when a different source is chosen and applies it', async () => {
    const { renderer, onApply, onClose } = await renderSheet();

    await act(async () => byText(renderer, 'Instagram').props.onPress());
    const selected = SOURCE_LABELS.filter((label) => byText(renderer, label).props.accessibilityState.selected);
    expect(selected).toEqual(['Instagram']);

    await act(async () => byText(renderer, 'Apply (1)').props.onPress());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ sourceFilter: 'instagram' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('labels the icon-only close button and keeps the backdrop out of the accessibility tree', async () => {
    const { renderer, onClose } = await renderSheet();

    const close = byLabel(renderer, 'Close filters')!;
    expect(close.props.accessibilityRole).toBe('button');
    await act(async () => close.props.onPress());
    expect(onClose).toHaveBeenCalledOnce();

    const pressables = renderer.root.findAllByType('Pressable' as unknown as React.ComponentType);
    expect(pressables.length).toBeGreaterThan(0);
    for (const pressable of pressables) expect(pressable.props.accessible).toBe(false);
  });
});

it('shows a guest Save action and records only the recipe intent before authentication', async () => {
  mocks.signedIn = false;
  mocks.push.mockClear(); mocks.save.mockClear(); guestRecipeIntent.clear();
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(<SaveButton recipeId="recipe-a" isOwner={false}
      colors={{ text: '#111', textMuted: '#666' } as React.ComponentProps<typeof SaveButton>['colors']} />); });
    await act(async () => renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
      .find(node => node.props.accessibilityLabel === 'Save recipe')!.props.onPress());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/(auth)/sign-in');
    expect(guestRecipeIntent.bind('session-a')).toMatchObject({ recipeId: 'recipe-a', action: 'save' });
  } finally { mocks.signedIn = true; guestRecipeIntent.clear(); await act(async () => renderer.unmount()); }
});

it('pauses the native Discover tab feed while another tab is focused', async () => {
  let renderer!: ReactTestRenderer;
  try {
    mocks.focused = false;
    await act(async () => { renderer = create(<DiscoverRoute />); });
    expect(mocks.feedEnabled).toBe(false);
    mocks.focused = true;
    await act(async () => renderer.update(<DiscoverRoute />));
    expect(mocks.feedEnabled).toBe(true);
  } finally { mocks.focused = true; await act(async () => renderer?.unmount()); }
});

it('keeps the 30-point Discover save circle in a 44-point target and preserves save state/actions', async () => {
  mocks.signedIn = true; mocks.save.mockClear(); mocks.unsave.mockClear(); mocks.push.mockClear();
  let renderer!: ReactTestRenderer;
  const colors = { text: '#111', textMuted: '#666' } as React.ComponentProps<typeof SaveButton>['colors'];
  const stopPropagation = vi.fn();
  try {
    await act(async () => { renderer = create(<SaveButton recipeId="public-a" initialIsSaved={false} isOwner={false} colors={colors} />); });
    expect(renderer.root.findAllByType('NativeView' as any).some(node => node.props.style?.width === 44 && node.props.style?.height === 44)).toBe(true);
    const save = byLabel(renderer, 'Save recipe')!;
    expect(save.props.style).toMatchObject({ width: 30, height: 30 });
    await act(async () => save.props.onPress({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledWith('public-a'); expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => renderer.update(<SaveButton recipeId="public-a" initialIsSaved isOwner={false} colors={colors} />));
    const unsave = byLabel(renderer, 'Remove recipe from saved')!;
    expect(unsave.props.accessibilityState.selected).toBe(true);
    await act(async () => unsave.props.onPress({ stopPropagation })); expect(mocks.unsave).toHaveBeenCalledWith('public-a');
    await act(async () => renderer.update(<SaveButton recipeId="public-a" initialIsSaved isOwner colors={colors} />));
    expect(touchables(renderer)).toHaveLength(0);
  } finally { await act(async () => renderer.unmount()); }
});

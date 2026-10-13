import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  searchArgs: [] as unknown[],
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    FlatList: host('FlatList'),
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
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'user-1', isSignedIn: true }) }));
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
vi.mock('@/components/AllContributorsModal', () => ({ default: () => null }));
vi.mock('@/components/Skeleton', () => ({ SkeletonRecipeList: () => null }));
vi.mock('@/components/Animated', () => ({ AnimatedListItem: () => null, ScalePressable: () => null }));
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
    useDiscoverRecipes: () => page,
    useSearchPublicRecipes: (args: unknown) => {
      mocks.searchArgs.push(args);
      return { ...page, isLoading: false, isFetching: false, isSuccess: true };
    },
    usePublicRecipeCount: () => ({ data: { count: 12 } }),
    useIsRecipeSaved: () => ({ data: false }),
    useSaveRecipe: () => ({ mutate: vi.fn() }),
    useUnsaveRecipe: () => ({ mutate: vi.fn() }),
    usePopularTags: () => ({ data: [] }),
    useTopContributors: () => ({ data: [] }),
    filterRecipesLocally: () => [],
  };
});

import DiscoverScreen from '../app/(tabs)/discover';
import FilterBottomSheet from '../components/FilterBottomSheet';

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

  it('labels the list/grid toggle with the layout it switches to', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DiscoverScreen />);
    });

    const toGrid = () => byLabel(renderer!, 'Show recipes as a grid');
    const toList = () => byLabel(renderer!, 'Show recipes as a list');
    expect(toList()?.props.accessibilityRole).toBe('button');
    expect(toGrid()).toBeUndefined();

    await act(async () => toList()!.props.onPress());
    expect(toGrid()?.props.accessibilityRole).toBe('button');
    expect(toList()).toBeUndefined();
  });

  it('announces the source filter selection through the filter sheet and the filter button', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DiscoverScreen />);
    });

    const filters = byLabel(renderer!, 'Filters')!;
    expect(filters.props.accessibilityRole).toBe('button');
    await act(async () => filters.props.onPress());

    await act(async () => byText(renderer!, 'YouTube').props.onPress());
    expect(byText(renderer!, 'YouTube').props.accessibilityState).toEqual({ selected: true });
    expect(byText(renderer!, 'All Sources').props.accessibilityState).toEqual({ selected: false });

    await act(async () => byText(renderer!, 'Apply (1)').props.onPress());
    expect(mocks.searchArgs.at(-1)).toEqual(expect.objectContaining({ sourceType: 'youtube' }));
    expect(byLabel(renderer!, 'Filters, 1 active')?.props.accessibilityRole).toBe('button');
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

  it('exposes every source filter as a button with its selected state', async () => {
    const { renderer } = await renderSheet('tiktok');

    for (const label of SOURCE_LABELS) {
      const chip = byText(renderer, label);
      expect(chip.props.accessibilityRole, label).toBe('button');
      expect(chip.props.accessibilityState, label).toEqual({ selected: label === 'TikTok' });
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

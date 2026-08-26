import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroceryItem } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  collapsedSections: JSON.stringify(['recipe:recipe-1']),
  groceryState: {
    items: [] as GroceryItem[] | undefined,
    isLoading: false,
    isError: false,
    isRefetchError: false,
    isRefetching: false,
  },
  refetch: vi.fn(),
  routerPush: vi.fn(),
  routerSetParams: vi.fn(),
}));

function host(name: string) {
  return (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
}

vi.mock('react-native', () => ({
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: vi.fn() },
  Keyboard: { dismiss: vi.fn() },
  Platform: { OS: 'ios' },
  RefreshControl: host('RefreshControl'),
  SectionList: ({
    sections,
    renderItem,
    renderSectionHeader,
    ListEmptyComponent,
  }: {
    sections: Array<{ key: string; data: GroceryItem[] }>;
    renderItem: (info: { item: GroceryItem; index: number; section: unknown }) => React.ReactNode;
    renderSectionHeader: (info: { section: unknown }) => React.ReactNode;
    ListEmptyComponent: React.ComponentType;
  }) => React.createElement(
    'SectionList',
    null,
    sections.length === 0
      ? React.createElement(ListEmptyComponent)
      : sections.flatMap((section) => [
          React.createElement(React.Fragment, { key: `${section.key}:header` }, renderSectionHeader({ section })),
          ...section.data.map((item, index) => React.createElement(
            React.Fragment,
            { key: item.id },
            renderItem({ item, index, section }),
          )),
        ]),
  ),
  Share: { share: vi.fn() },
  StyleSheet: { create: <T,>(styles: T) => styles },
  TextInput: host('TextInput'),
  TouchableOpacity: host('TouchableOpacity'),
  View: host('NativeView'),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mocks.routerPush, setParams: mocks.routerSetParams }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => mocks.collapsedSections),
    setItem: vi.fn(async () => undefined),
  },
}));
vi.mock('@/components/Themed', () => ({
  Button: ({ title, ...props }: { title: string }) => React.createElement('Button', { title, ...props }),
  Text: host('Text'),
  View: host('ThemedView'),
  useColors: () => ({
    background: '#fff',
    backgroundSecondary: '#f5f1ec',
    border: '#ddd',
    card: '#fff',
    cardBorder: '#ddd',
    error: '#c00',
    success: '#087',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#444',
    tint: '#a43',
  }),
}));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: host('SignInBanner') }));
vi.mock('@/components/EditGroceryItemModal', () => ({ default: host('EditGroceryItemModal') }));
vi.mock('@/components/GroceryListSettingsModal', () => ({ default: host('GroceryListSettingsModal') }));
vi.mock('@/components/GrocerySectionHeader', () => ({
  GrocerySectionHeader: (props: Record<string, unknown>) =>
    React.createElement('GrocerySectionHeader', props),
}));
vi.mock('@/components/Animated', () => ({
  AnimatedListItem: ({ children }: { children: React.ReactNode }) => children,
  ScalePressable: host('ScalePressable'),
}));
vi.mock('@/hooks/useTextSize', () => ({
  useTextSize: () => ({ scaleFontSize: (size: number) => size }),
}));
vi.mock('@/utils/haptics', () => ({
  haptics: {
    light: vi.fn(),
    medium: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 10, sm: 12, md: 14, xl: 20, xxl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { sm: 6, md: 10, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/lib/groceryFilters', () => ({
  filterGroceryItems: (items: GroceryItem[], query: string) => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? items.filter((entry) => `${entry.name} ${entry.recipe_title ?? ''}`.toLowerCase().includes(normalized))
      : [...items];
  },
}));
vi.mock('@/lib/grocerySections', () => ({
  OTHER_GROCERY_SECTION_KEY: 'other-items',
  groupGroceryItems: (items: GroceryItem[]) => {
    if (items.length === 0) return [];
    return [{
      key: 'recipe:recipe-1',
      title: 'Chicken Kelaguen',
      recipeId: 'recipe-1',
      data: items,
      checkedCount: items.filter((entry) => entry.checked).length,
      totalCount: items.length,
    }];
  },
}));
vi.mock('@/lib/routes', () => ({
  appRoutes: {
    discover: '/(tabs)/discover',
    planner: '/(tabs)/planner',
    recipe: (id: string) => `/recipe/${id}`,
  },
}));

function mutation() {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  };
}

vi.mock('@/hooks/useGrocery', () => ({
  useAddGroceryItem: mutation,
  useClearAllItems: mutation,
  useClearCheckedItems: mutation,
  useDeleteGroceryItem: mutation,
  useDeleteGroceryItems: mutation,
  useGroceryCount: () => {
    const items = mocks.groceryState.items ?? [];
    const checked = items.filter((item) => item.checked).length;
    return { data: { total: items.length, checked, unchecked: items.length - checked } };
  },
  useGroceryList: (includeChecked: boolean) => ({
    data: mocks.groceryState.items?.filter((item) => includeChecked || !item.checked),
    isLoading: mocks.groceryState.isLoading,
    isError: mocks.groceryState.isError,
    isRefetchError: mocks.groceryState.isRefetchError,
    isRefetching: mocks.groceryState.isRefetching,
    refetch: mocks.refetch,
  }),
  useGroceryListInfo: () => ({ data: { is_shared: false } }),
  useGrocerySync: () => ({ lastSyncResult: null, clearSyncResult: vi.fn() }),
  useToggleGroceryItem: mutation,
  useUpdateGroceryItem: mutation,
}));

import GroceryScreen from '../app/(tabs)/grocery';

function item(overrides: Partial<GroceryItem> & Pick<GroceryItem, 'id' | 'name'>): GroceryItem {
  return {
    quantity: null,
    unit: null,
    notes: null,
    checked: false,
    recipe_id: 'recipe-1',
    recipe_title: 'Chicken Kelaguen',
    added_by_name: null,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
    ...overrides,
  };
}

describe('GroceryScreen shopping views', () => {
  beforeEach(() => {
    mocks.collapsedSections = JSON.stringify(['recipe:recipe-1']);
    mocks.groceryState.items = [];
    mocks.groceryState.isLoading = false;
    mocks.groceryState.isError = false;
    mocks.groceryState.isRefetchError = false;
    mocks.groceryState.isRefetching = false;
    mocks.refetch.mockReset();
  });

  it('exposes a search match from a previously collapsed recipe section', async () => {
    mocks.groceryState.items = [item({ id: 'rice', name: 'Rice' })];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });
      expect(renderer.container.queryAll((instance) => instance.type === 'ScalePressable')).toHaveLength(0);

      const searchInput = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      ).find((input) => input.props.accessibilityLabel === 'Search grocery items and recipes');
      await act(async () => searchInput!.props.onChangeText('rice'));

      expect(renderer.container.queryAll((instance) => instance.type === 'ScalePressable')).toHaveLength(1);
      const header = renderer.container.queryAll(
        (instance) => instance.type === 'GrocerySectionHeader',
      )[0];
      expect(header.props.isCollapsible).toBe(false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('switches between unchecked groceries and the complete list', async () => {
    mocks.collapsedSections = '[]';
    mocks.groceryState.items = [
      item({ id: 'rice', name: 'Rice' }),
      item({ id: 'lime', name: 'Lime', checked: true }),
    ];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });
      expect(renderer.container.queryAll((instance) => instance.type === 'ScalePressable')).toHaveLength(1);

      const allTab = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === '2 total grocery items');
      await act(async () => allTab!.props.onPress());
      expect(renderer.container.queryAll((instance) => instance.type === 'ScalePressable')).toHaveLength(2);

      const toBuyTab = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === '1 items to buy');
      await act(async () => toBuyTab!.props.onPress());
      expect(renderer.container.queryAll((instance) => instance.type === 'ScalePressable')).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('offers retry for an initial failure and disables it during refetch', async () => {
    mocks.groceryState.items = undefined;
    mocks.groceryState.isError = true;
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });
      let retry = renderer.container.queryAll(
        (instance) => instance.type === 'Button',
      ).find((button) => button.props.title === 'Try again');
      expect(retry?.props.disabled).toBe(false);
      await act(async () => retry!.props.onPress());
      expect(mocks.refetch).toHaveBeenCalledOnce();

      mocks.groceryState.isRefetching = true;
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });
      retry = renderer.container.queryAll(
        (instance) => instance.type === 'Button',
      ).find((button) => button.props.title === 'Trying again…');
      expect(retry?.props.disabled).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

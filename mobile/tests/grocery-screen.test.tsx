import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Platform } from 'react-native';
import type { GroceryItem } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  collapsedSections: JSON.stringify(['recipe:recipe-1']),
  queued: false as boolean | undefined,
  groceryState: {
    items: [] as GroceryItem[] | undefined,
    isLoading: false,
    isError: false,
    isRefetchError: false,
    isRefetching: false,
    serverConfirmedAt: undefined as string | undefined,
    freshness: "checking" as string,
  },
  authState: {
    isLoaded: true,
    isSignedIn: true as boolean | undefined,
  },
  listInfoState: { is_shared: false },
  listEnabledArgs: [] as boolean[],
  countEnabledArgs: [] as boolean[],
  alert: vi.fn(),
  share: vi.fn(),
  refetch: vi.fn(),
  addItem: vi.fn(),
  deleteItems: vi.fn(),
  success: vi.fn(),
  focusCallback: vi.fn() as () => void,
  routerPush: vi.fn(),
  routerSetParams: vi.fn(),
}));

function host(name: string) {
  return (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
}

vi.mock('react-native', () => ({
  PanResponder: { create: (handlers: any) => ({ panHandlers: handlers }) },
  useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1, scale: 3 }),
  ActivityIndicator: host('ActivityIndicator'),
  Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  ScrollView: host('ScrollView'),
  Alert: { alert: mocks.alert },
  ActionSheetIOS: { showActionSheetWithOptions: (options: any, callback: any) => mocks.alert('Actions', undefined, options.options.map((text: string, index: number) => ({ text, onPress: () => callback(index) }))) },
  Keyboard: { dismiss: vi.fn() },
  Platform: { OS: 'ios' },
  RefreshControl: host('RefreshControl'),
  SectionList: ({
    sections,
    renderItem,
    renderSectionHeader,
    ListEmptyComponent,
    ListFooterComponent, ListHeaderComponent,
  }: {
    sections: Array<{ key: string; data: GroceryItem[] }>;
    renderItem: (info: { item: GroceryItem; index: number; section: unknown }) => React.ReactNode;
    renderSectionHeader: (info: { section: unknown }) => React.ReactNode;
    ListEmptyComponent: React.ComponentType;
    ListFooterComponent: React.ReactNode; ListHeaderComponent: React.ReactNode;
  }) => React.createElement(
    'SectionList',
    null, ListHeaderComponent,
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
    ListFooterComponent,
  ),
  Share: { share: mocks.share },
  StyleSheet: { create: <T,>(styles: T) => styles },
  TextInput: host('TextInput'),
  TouchableOpacity: host('TouchableOpacity'),
  View: host('NativeView'),
}));

vi.mock('expo-router', () => ({ Stack: { Screen: (props: any) => React.createElement(React.Fragment, null, props.options?.headerLeft?.(), props.options?.headerRight?.(), props.options?.headerSearchBarOptions ? React.createElement('NativeSearch', props.options.headerSearchBarOptions) : null, props.options?.title ? React.createElement('Text', null, props.options.title) : null) },
  useFocusEffect: (callback: () => void) => { mocks.focusCallback = callback; },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mocks.routerPush, setParams: mocks.routerSetParams }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('@clerk/expo', () => ({ useAuth: () => mocks.authState }));
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
    warning: '#b70',
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
    success: mocks.success,
    warning: vi.fn(),
  },
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { display: 'Fraunces' },
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
    pantry: '/pantry',
    planner: '/(tabs)/planner',
    recipe: (id: string) => `/recipe/${id}`,
  },
}));

vi.mock('@/hooks/usePantry', () => ({
  usePantrySnapshot: () => ({ data: { scope: 'personal', transferred_grocery_item_ids: [] } }),
  useTransferGroceriesToPantry: mutation,
}));

function mutation() {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  };
}

vi.mock('@/hooks/useGrocery', () => ({
  useAddGroceryItem: () => ({ ...mutation(), mutate: mocks.addItem }),
  useClearAllItems: mutation,
  useClearCheckedItems: mutation,
  useDeleteGroceryItem: mutation,
  useDeleteGroceryItems: () => ({ ...mutation(), mutate: mocks.deleteItems }),
  useGroceryCount: (isSignedIn: boolean) => {
    mocks.countEnabledArgs.push(isSignedIn);
    const items = mocks.groceryState.items ?? [];
    const checked = items.filter((item) => item.checked).length;
    return { data: { total: items.length, checked, unchecked: items.length - checked } };
  },
  useGroceryList: (includeChecked: boolean, isSignedIn: boolean) => {
    mocks.listEnabledArgs.push(isSignedIn);
    return {
      data: mocks.groceryState.items?.filter((item) => includeChecked || !item.checked),
      isLoading: mocks.groceryState.isLoading,
      isError: mocks.groceryState.isError,
      isRefetchError: mocks.groceryState.isRefetchError,
      isRefetching: mocks.groceryState.isRefetching,
      serverConfirmedAt: mocks.groceryState.serverConfirmedAt,
      freshness: mocks.groceryState.freshness,
      refetch: mocks.refetch,
    };
  },
  useGroceryListInfo: () => ({ data: mocks.listInfoState }),
  usePendingGrocerySync: () => ({ data: mocks.queued }),
  useGrocerySync: () => ({ lastSyncResult: null, clearSyncResult: vi.fn() }),
  useToggleGroceryItem: mutation,
  useUpdateGroceryItem: mutation,
}));

import GroceryScreen from '../app/(tabs)/grocery';

function renderedText(renderer: ReturnType<typeof createRoot>): string {
  return renderer.container.queryAll((instance) => instance.type === 'Text')
    .flatMap((instance) => instance.props.children ?? [])
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

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
    mocks.queued = false;
    mocks.authState.isLoaded = true;
    mocks.authState.isSignedIn = true;
    mocks.listInfoState.is_shared = false;
    mocks.listEnabledArgs = [];
    mocks.countEnabledArgs = [];
    mocks.collapsedSections = JSON.stringify(['recipe:recipe-1']);
    mocks.groceryState.items = [];
    mocks.groceryState.isLoading = false;
    mocks.groceryState.isError = false;
    mocks.groceryState.isRefetchError = false;
    mocks.groceryState.isRefetching = false;
    mocks.refetch.mockReset();
    mocks.focusCallback = vi.fn();
    mocks.alert.mockReset();
    mocks.addItem.mockReset(); mocks.success.mockClear();
    mocks.share.mockReset();
  });

  it('waits for the add mutation to succeed before confirming with haptics', async () => {
    const r = createRoot({ textComponentTypes: ['Text'] });
    await act(async () => r.render(<GroceryScreen />));
    const input = r.container.queryAll(n => n.type === 'TextInput')[0];
    await act(async () => input.props.onChangeText('Rice'));
    await act(async () => r.container.queryAll(n => n.type === 'TextInput')[0].props.onSubmitEditing());
    expect(mocks.addItem).toHaveBeenCalledOnce();
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => r.container.queryAll(n => n.type === 'TextInput')[0].props.onChangeText('Eggs'));
    await act(async () => mocks.addItem.mock.calls[0][1].onSuccess({ syncStatus: 'confirmed' }));
    expect(r.container.queryAll(n => n.type === 'TextInput')[0].props.value).toBe('Eggs');
    expect(mocks.success).toHaveBeenCalledOnce();
    mocks.success.mockClear();
    await act(async () => mocks.addItem.mock.calls[0][1].onSuccess({ syncStatus: 'queued' }));
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });

  it('revalidates an aged shared list but leaves a personal list alone on focus', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(GroceryScreen)));
      await act(async () => mocks.focusCallback());
      expect(mocks.refetch).not.toHaveBeenCalled();

      mocks.listInfoState.is_shared = true;
      await act(async () => renderer.render(React.createElement(GroceryScreen)));
      await act(async () => mocks.focusCallback());
      expect(mocks.refetch).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows an intentional guest preview without starting private grocery queries', async () => {
    mocks.authState.isSignedIn = false;
    mocks.groceryState.isLoading = true;
    mocks.groceryState.isError = true;
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      expect(mocks.listEnabledArgs.at(-1)).toBe(false);
      expect(mocks.countEnabledArgs.at(-1)).toBe(false);
      const copy = renderedText(renderer);
      expect(copy).toContain('One list for the whole meal');
      expect(copy).not.toContain('Loading your grocery list');
      expect(copy).not.toContain('Couldn’t load your list');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'GroceryListSettingsModal',
      )).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SignInBanner',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('waits for Clerk without flashing guest UI or starting private queries', async () => {
    mocks.authState.isLoaded = false;
    mocks.authState.isSignedIn = undefined;
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      expect(mocks.listEnabledArgs.at(-1)).toBe(false);
      expect(mocks.countEnabledArgs.at(-1)).toBe(false);
      const copy = renderedText(renderer);
      expect(copy).toContain('Checking your account…');
      expect(copy).not.toContain('One list for the whole meal');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SignInBanner',
      )).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('hides cached account data and shared-list controls after sign-out', async () => {
    mocks.collapsedSections = '[]';
    mocks.groceryState.items = [item({ id: 'private-rice', name: 'Private rice' })];
    mocks.listInfoState.is_shared = true;
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Ionicons' && instance.props.name === 'ellipsis-horizontal',
      )).toHaveLength(1);

      mocks.authState.isSignedIn = false;
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox',
      )).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Ionicons' && instance.props.name === 'ellipsis-horizontal',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('exposes a search match from a previously collapsed recipe section', async () => {
    mocks.groceryState.items = [item({ id: 'rice', name: 'Rice' })];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });
      expect(renderer.container.queryAll((instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox')).toHaveLength(0);

      const searchInput = renderer.container.queryAll(
        (instance) => instance.type === 'NativeSearch',
      )[0];
      await act(async () => searchInput!.props.onChangeText({ nativeEvent: { text: 'rice' } }));

      expect(renderer.container.queryAll((instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox')).toHaveLength(1);
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
      expect(renderer.container.queryAll((instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox')).toHaveLength(1);

      const allTab = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Show all grocery items');
      await act(async () => allTab!.props.onPress());
      expect(renderer.container.queryAll((instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox')).toHaveLength(2);

      const toBuyTab = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Show items to buy');
      await act(async () => toBuyTab!.props.onPress());
      expect(renderer.container.queryAll((instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox')).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('labels a grocery item when its recipe did not state an amount', async () => {
    mocks.collapsedSections = '[]';
    mocks.groceryState.items = [item({
      id: 'lime',
      name: 'Lime',
      quantity: null,
      unit: 'piece',
    })];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      expect(renderedText(renderer)).toContain('Amount not stated');
      expect(renderedText(renderer)).not.toContain('piece');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('exposes each grocery row as a checkbox with labelled edit and remove controls', async () => {
    mocks.collapsedSections = '[]';
    mocks.listInfoState.is_shared = true;
    mocks.groceryState.items = [
      item({ id: 'rice', name: 'Rice', notes: 'Jasmine', added_by_name: 'Ana' }),
      item({ id: 'lime', name: 'Lime', quantity: '2', unit: 'piece', recipe_id: null }),
    ];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      const rows = renderer.container.queryAll((instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox');
      const row = rows.find((candidate) => candidate.props.accessibilityLabel.startsWith('Rice'))!;
      expect(row.props.accessibilityRole).toBe('checkbox');
      expect(row.props.accessibilityState).toEqual({ checked: false });
      expect(row.props.accessibilityLabel).toBe('Rice, Added by Ana, Amount not stated, Jasmine');
      expect(rows.find((candidate) => candidate.props.accessibilityLabel.startsWith('2'))!.props.accessibilityLabel)
        .toBe('2 piece Lime');
      const edit = renderer.container.queryAll(instance => instance.props.accessibilityLabel === 'Edit Rice' && instance.props.accessibilityRole === 'button')[0];
      expect(edit).toBeDefined();
      expect(edit.props.accessibilityActions).toEqual([{ name: 'remove', label: 'Remove Rice' }]);
      await act(async () => edit.props.onPress());
      expect(renderer.container.queryAll(instance => instance.type === 'EditGroceryItemModal')[0].props.item.name).toBe('Rice');
      await act(async () => edit.props.onLongPress());
      expect(mocks.alert.mock.calls.at(-1)![2].map((action: any) => action.text)).toContain('Delete item');

    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps recipe progress and removal complete when checked items are hidden', async () => {
    mocks.collapsedSections = '[]';
    mocks.groceryState.items = [item({ id: 'rice', name: 'Rice', recipe_id: 'recipe-1', recipe_title: 'Chicken Kelaguen' }), item({ id: 'salt', name: 'Salt', recipe_id: 'recipe-1', recipe_title: 'Chicken Kelaguen', checked: true })];
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      const header = renderer.container.queryAll(node => node.type === 'GrocerySectionHeader')[0];
      expect(header.props.section.checkedCount).toBe(1);
      expect(header.props.section.totalCount).toBe(2);
      await act(async () => header.props.onClearSection());
      const actions = mocks.alert.mock.calls.at(-1)![2];
      await act(async () => actions.find((action: any) => action.text === 'Clear').onPress());
      expect(mocks.deleteItems).toHaveBeenCalledWith(['rice', 'salt'], expect.any(Object));
    } finally { await act(async () => renderer.unmount()); }
  });

  it('does not turn a quick manual grocery entry into a recipe warning', async () => {
    mocks.collapsedSections = '[]';
    mocks.groceryState.items = [item({
      id: 'milk',
      name: 'Milk',
      quantity: null,
      recipe_id: null,
      recipe_title: null,
    })];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      expect(renderedText(renderer)).not.toContain('Amount not stated');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('normalizes legacy units in grocery rows and exported text', async () => {
    mocks.collapsedSections = '[]';
    mocks.groceryState.items = [
      item({ id: 'salt', name: 'Salt', quantity: '1', unit: ' NULL ' }),
      item({ id: 'oil', name: 'Oil', quantity: '1', unit: ' tbsp ' }),
    ];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      const copy = renderedText(renderer);
      expect(copy.toLowerCase()).not.toContain('null');
      expect(copy).toContain('tbsp ');

      const overflow = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'More grocery list actions');
      await act(async () => overflow!.props.onPress());
      const actions = mocks.alert.mock.calls.at(-1)?.[2] as Array<{
        text: string;
        onPress?: () => Promise<void>;
      }>;
      const exportAction = actions.find((action) => action.text === 'Export text — To buy');
      await act(async () => exportAction!.onPress!());

      const message = mocks.share.mock.calls.at(-1)?.[0]?.message as string;
      expect(message).toContain('Grocery List — To buy');
      expect(message).toContain('[ ] 1 Salt');
      expect(message).toContain('[ ] 1 tbsp Oil');
      expect(message.toLowerCase()).not.toContain('null');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps household sharing reachable on Android without truncating the action list', async () => {
    Object.assign(Platform, { OS: 'android' });
    const root = createRoot();
    try {
      await act(async () => root.render(<GroceryScreen />));
      await act(async () => root.container.queryAll(node => node.props.accessibilityLabel === 'More grocery list actions')[0].props.onPress());
      const household = root.container.queryAll(node => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === 'Household sharing & list settings')[0];
      expect(household).toBeDefined();
      await act(async () => household.props.onPress());
      expect(root.container.queryAll(node => node.type === 'GroceryListSettingsModal')[0].props.isVisible).toBe(true);
    } finally { Object.assign(Platform, { OS: 'ios' }); await act(async () => root.unmount()); }
  });

  it('separates native search from quick entry and names the exported view', async () => {
    mocks.groceryState.items = [item({ id: 'rice', name: 'Rice' }), item({ id: 'salt', name: 'Salt' })];
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(GroceryScreen)));
      const inputs = renderer.container.queryAll(node => node.type === 'NativeSearch');
      expect(renderer.container.queryAll(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Add an item')).toHaveLength(1);
      expect(inputs).toHaveLength(1);
      await act(async () => inputs[0].props.onChangeText({ nativeEvent: { text: 'rice' } }));
      const overflow = renderer.container.queryAll((node) => node.props.accessibilityLabel === 'More grocery list actions')[0];
      await act(async () => overflow.props.onPress());
      const actions = mocks.alert.mock.calls.at(-1)![2];
      await act(async () => actions.find((action: { text: string }) => action.text === 'Export text — Search matches').onPress());
      expect(mocks.share.mock.calls.at(-1)![0].message).toContain('Grocery List — Search matches');
      expect(mocks.share.mock.calls.at(-1)![0].message).not.toContain('Salt');
      expect(actions.some((action: { text: string }) => action.text === 'Household sharing & list settings')).toBe(true);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('labels singular pantry transfers and recovered queued changes', async () => {
    mocks.queued = true;
    mocks.groceryState.items = [item({ id: 'rice', name: 'Rice', checked: true })];
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(GroceryScreen)));
      expect(renderedText(renderer)).toContain('Saved on this device · waiting to sync');
      expect(renderedText(renderer)).not.toContain('Up to date');
      expect(renderedText(renderer)).not.toContain('Confirmed');
      expect(renderer.container.queryAll((node) => node.props.accessibilityLabel === 'Add 1 checked item to pantry')).toHaveLength(1);
    } finally { await act(async () => renderer.unmount()); }
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
  it.each([
    [undefined, 'checking', undefined, 'Checking sync status'],
    [false, 'offline', undefined, 'Offline · showing this device’s list'],
    [false, 'stale', '2026-10-31T01:00:00Z', 'Couldn’t refresh · showing this device’s list'],
    [false, 'confirmed', '2026-10-31T01:00:00Z', ''],
  ])('reports snapshot freshness honestly (%s, %s)', async (queued, freshness, confirmedAt, text) => {
    mocks.queued = queued as boolean | undefined;
    mocks.groceryState.freshness = freshness as string;
    mocks.groceryState.serverConfirmedAt = confirmedAt as string | undefined;
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(GroceryScreen)));
      expect(renderedText(renderer)).toContain(text);
      expect(renderedText(renderer)).not.toContain('Up to date');
      expect(renderedText(renderer)).not.toContain('Confirmed');
    } finally { await act(async () => renderer.unmount()); }
  });

});

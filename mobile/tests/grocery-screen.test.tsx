vi.mock('@/components/chrome/HeaderButton', () => ({ HeaderIconButton: 'TouchableOpacity', headerRightOptions: (render: () => unknown) => ({ headerRight: render }) }));
vi.mock('@/components/chrome/SegmentedControl', () => ({ SegmentedControl: 'SegmentedControl' }));
vi.mock('@/components/chrome/Chips', () => ({ Chip: 'Chip' }));
vi.mock('@/components/TabChrome', () => ({ AccountHeaderButton: 'AccountHeaderButton' }));
import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  configureNext: vi.fn(),
  toggleItem: vi.fn(),
  deleteItem: vi.fn(),
  restoreItem: vi.fn(),
  blurInput: vi.fn(),
  toast: vi.fn(),
  reduceMotion: false,
  widgetCollapsed: null as null | { accountScopeId: string | null; listId: string | null; keys: string[]; updatedAt: number | null },
  setWidgetCollapsed: vi.fn(async (_accountScopeId: string, _listId: string, _keys: string[], _updatedAt: number) => true),
  // Device storage; the fold record falls back to `collapsedSections` for the
  // current account and list until the screen writes one.
  storage: new Map<string, string>(),
  storageGate: null as Promise<void> | null,
  accountScopeId: 'gacct_a' as string | undefined,
  listId: 'list-1',
  focusers: new Set<() => void>(),
}));
const FOLDS_KEY = '@hafa_grocery_collapsed_sections_v3';
vi.mock('@/lib/toast', () => ({ showToast: mocks.toast }));
vi.mock('hafa-widget-bridge', () => ({ HafaWidgetBridge: {
  getCollapsedSections: async () => mocks.widgetCollapsed,
  setCollapsedSections: mocks.setWidgetCollapsed,
} }));

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
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  AccessibilityInfo: { addEventListener: () => ({ remove: vi.fn() }), isReduceMotionEnabled: async () => mocks.reduceMotion },
  LayoutAnimation: { create: () => ({}), configureNext: mocks.configureNext, Types: {}, Properties: {} },
  Platform: { OS: 'ios' },
  RefreshControl: host('RefreshControl'),
  SectionList: ({
    sections,
    renderItem,
    renderSectionHeader,
    ListEmptyComponent,
    ListFooterComponent, ListHeaderComponent,
    onScrollBeginDrag,
  }: {
    sections: Array<{ key: string; data: GroceryItem[] }>;
    renderItem: (info: { item: GroceryItem; index: number; section: unknown }) => React.ReactNode;
    renderSectionHeader: (info: { section: unknown }) => React.ReactNode;
    ListEmptyComponent: React.ComponentType;
    ListFooterComponent: React.ReactNode; ListHeaderComponent: React.ReactNode;
    onScrollBeginDrag?: unknown;
  }) => React.createElement(
    'SectionList',
    { onScrollBeginDrag }, ListHeaderComponent,
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
  // A focus runs every mounted focus callback: the screen's and the collapse hook's.
  useFocusEffect: (callback: () => void) => {
    mocks.focusCallback = () => mocks.focusers.forEach((registered) => registered());
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => { mocks.focusers.add(callback); return () => { mocks.focusers.delete(callback); }; }, [callback]);
  },
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
    getItem: vi.fn(async (key: string) => {
      if (mocks.storageGate) await mocks.storageGate;
      if (mocks.storage.has(key)) return mocks.storage.get(key)!;
      return key === FOLDS_KEY
        ? JSON.stringify({ [JSON.stringify([mocks.accountScopeId, mocks.listId])]: JSON.parse(mocks.collapsedSections) })
        : null;
    }),
    setItem: vi.fn(async (key: string, value: string) => { mocks.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mocks.storage.delete(key); }),
  },
}));
vi.mock('@/components/Themed', async () => ({
  // A ref with the focus methods the screen calls on its quick-entry field.
  TextInput: React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: vi.fn(), blur: mocks.blurInput }));
    return React.createElement('TextInput', props);
  }),
  TextScaleContext: (await import('react')).createContext(1),
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
vi.mock('@/constants/Colors', () => ({ layout: { margin: 20, gridGap: 16, section: 32 },
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
  useDeleteGroceryItem: () => ({ ...mutation(), mutate: mocks.deleteItem }),
  useRestoreGroceryItem: () => ({ ...mutation(), mutate: mocks.restoreItem }),
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
  useGroceryListInfo: () => ({ data: { id: mocks.listId, ...mocks.listInfoState }, accountScopeId: mocks.accountScopeId }),
  usePendingGrocerySync: () => ({ data: mocks.queued }),
  useGrocerySync: () => ({ lastSyncResult: null, clearSyncResult: vi.fn() }),
  useToggleGroceryItem: () => ({ ...mutation(), mutate: mocks.toggleItem }),
  useUpdateGroceryItem: mutation,
}));

import GroceryScreen from '../app/(tabs)/grocery';

beforeEach(() => {
  mocks.storage.clear();
  mocks.storageGate = null;
  mocks.accountScopeId = 'gacct_a';
  mocks.listId = 'list-1';
});

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
        (instance) => instance.props.accessibilityLabel === 'More grocery list actions',
      )).toHaveLength(1);

      mocks.authState.isSignedIn = false;
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox',
      )).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'More grocery list actions',
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

      const view = () => renderer.container.queryAll((instance) => instance.type === 'SegmentedControl')[0];
      expect(view().props.value).toBe('toBuy');
      expect(view().props.options.map((option: { label: string }) => option.label)).toEqual(['To buy', 'All']);
      await act(async () => view().props.onChange('all'));
      expect(renderer.container.queryAll((instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox')).toHaveLength(2);

      expect(view().props.value).toBe('all');
      await act(async () => view().props.onChange('toBuy'));
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
        .toBe('2 pieces Lime');
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
      item({ id: 'lime', name: 'Lime', quantity: '2', unit: 'piece' }),
    ];
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GroceryScreen));
      });

      const copy = renderedText(renderer);
      expect(copy.toLowerCase()).not.toContain('null');
      expect(copy).toMatch(/1 tbsp(\s|$)/);

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
      expect(message).toContain('[ ] 2 pieces Lime');
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

describe('GroceryScreen collapsible recipe sections', () => {
  const checkboxes = (renderer: ReturnType<typeof createRoot>) => renderer.container.queryAll(
    (instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityRole === 'checkbox',
  );
  const header = (renderer: ReturnType<typeof createRoot>, key: string) => renderer.container.queryAll(
    (instance) => instance.type === 'GrocerySectionHeader' && instance.props.section.key === key,
  )[0];
  const button = (renderer: ReturnType<typeof createRoot>, label: string) => renderer.container.queryAll(
    (instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityLabel === label,
  )[0];
  const focusScreen = () => mocks.focusCallback();
  const savedFolds = (accountScopeId = 'gacct_a', listId = 'list-1') =>
    JSON.parse(mocks.storage.get(FOLDS_KEY) ?? '{}')[JSON.stringify([accountScopeId, listId])];
  /** Holds device storage reads until the returned function is called. */
  const holdStorage = () => {
    let release = () => {};
    mocks.storageGate = new Promise<void>((resolve) => { release = () => { mocks.storageGate = null; resolve(); }; });
    return release;
  };

  beforeEach(() => {
    mocks.authState.isLoaded = true;
    mocks.authState.isSignedIn = true;
    mocks.listInfoState.is_shared = false;
    mocks.collapsedSections = '[]';
    mocks.widgetCollapsed = null;
    mocks.reduceMotion = false;
    mocks.setWidgetCollapsed.mockClear();
    mocks.configureNext.mockClear();
    vi.mocked(AsyncStorage.setItem).mockClear();
    mocks.groceryState.items = [
      item({ id: 'lemons', name: 'Lemons' }),
      item({ id: 'coconut', name: 'Coconut' }),
      item({ id: 'pork', name: 'Pork belly', recipe_id: 'recipe-2', recipe_title: 'Adobo' }),
      item({ id: 'rice', name: 'Rice', recipe_id: null, recipe_title: null }),
    ];
  });

  it('folds a recipe with one tap, saves it for this list and tells the widget', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(checkboxes(renderer)).toHaveLength(4);

      await act(async () => header(renderer, 'recipe:recipe-1').props.onToggle());
      expect(checkboxes(renderer)).toHaveLength(2);
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(true);
      expect(mocks.configureNext).toHaveBeenCalledOnce();
      const [storageKey, stored] = vi.mocked(AsyncStorage.setItem).mock.calls.at(-1)!;
      expect(storageKey).toBe(FOLDS_KEY);
      expect(JSON.parse(stored)['["gacct_a","list-1"]'].keys).toEqual(['recipe:recipe-1']);
      expect(mocks.setWidgetCollapsed).toHaveBeenLastCalledWith('gacct_a', 'list-1', ['recipe:recipe-1'], expect.any(Number));

      await act(async () => header(renderer, 'recipe:recipe-1').props.onToggle());
      expect(checkboxes(renderer)).toHaveLength(4);
      expect(mocks.setWidgetCollapsed).toHaveBeenLastCalledWith('gacct_a', 'list-1', [], expect.any(Number));
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows section counts from the whole list while To buy hides checked items', async () => {
    mocks.groceryState.items = [...mocks.groceryState.items!, item({ id: 'garlic', name: 'Garlic', checked: true })];
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      const section = header(renderer, 'recipe:recipe-1').props.section;
      expect(section.totalCount).toBe(3);
      expect(section.checkedCount).toBe(1);
      expect(checkboxes(renderer)).toHaveLength(4);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('adopts a newer fold made on the widget for the same list', async () => {
    mocks.collapsedSections = JSON.stringify({ keys: [], updatedAt: 1 });
    mocks.widgetCollapsed = { accountScopeId: 'gacct_a', listId: 'list-1', keys: ['recipe:recipe-2'], updatedAt: 5 };
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(header(renderer, 'recipe:recipe-2').props.isCollapsed).toBe(true);
      expect(checkboxes(renderer)).toHaveLength(3);
      expect(mocks.setWidgetCollapsed).not.toHaveBeenCalled();
      // No fold animation for a change made elsewhere.
      expect(mocks.configureNext).not.toHaveBeenCalled();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps its own fold and updates a widget that is behind or another list', async () => {
    mocks.collapsedSections = JSON.stringify({ keys: ['recipe:recipe-1'], updatedAt: 9 });
    mocks.widgetCollapsed = { accountScopeId: 'gacct_a', listId: 'list-1', keys: [], updatedAt: null };
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(true);
      expect(mocks.setWidgetCollapsed).toHaveBeenCalledWith('gacct_a', 'list-1', ['recipe:recipe-1'], 9);

      mocks.setWidgetCollapsed.mockClear();
      mocks.widgetCollapsed = { accountScopeId: 'gacct_a', listId: 'another-list', keys: ['recipe:recipe-2'], updatedAt: 99 };
      await act(async () => focusScreen());
      expect(header(renderer, 'recipe:recipe-2').props.isCollapsed).toBe(false);
      // Same shared list, another account's widget.
      mocks.widgetCollapsed = { accountScopeId: 'gacct_b', listId: 'list-1', keys: ['recipe:recipe-2'], updatedAt: 99 };
      await act(async () => focusScreen());
      expect(header(renderer, 'recipe:recipe-2').props.isCollapsed).toBe(false);
      expect(mocks.setWidgetCollapsed).not.toHaveBeenCalled();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('waits for the saved fold before comparing with an older widget copy', async () => {
    // The app folded Kelaguen at 1000; the widget last changed at 500.
    mocks.collapsedSections = JSON.stringify({ keys: ['recipe:recipe-1'], updatedAt: 1000 });
    mocks.widgetCollapsed = { accountScopeId: 'gacct_a', listId: 'list-1', keys: ['recipe:recipe-2'], updatedAt: 500 };
    const release = holdStorage();
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      // Focus and a tap arrive before device storage answers.
      await act(async () => focusScreen());
      await act(async () => header(renderer, 'recipe:recipe-2').props.onToggle());
      expect(mocks.setWidgetCollapsed).not.toHaveBeenCalled();
      expect(vi.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();

      await act(async () => release());
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(true);
      expect(header(renderer, 'recipe:recipe-2').props.isCollapsed).toBe(false);
      // The widget is behind, so it gets the app's copy.
      expect(mocks.setWidgetCollapsed).toHaveBeenLastCalledWith('gacct_a', 'list-1', ['recipe:recipe-1'], 1000);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it("never shows the previous list's folds while another list loads", async () => {
    mocks.collapsedSections = JSON.stringify({ keys: ['recipe:recipe-1'], updatedAt: 1000 });
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(true);

      mocks.collapsedSections = JSON.stringify({ keys: ['recipe:recipe-2'], updatedAt: 2000 });
      const release = holdStorage();
      mocks.listId = 'list-2';
      await act(async () => renderer.render(<GroceryScreen />));
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(false);
      expect(header(renderer, 'recipe:recipe-2').props.isCollapsed).toBe(false);
      mocks.setWidgetCollapsed.mockClear();
      await act(async () => header(renderer, 'recipe:recipe-1').props.onToggle());
      expect(mocks.setWidgetCollapsed).not.toHaveBeenCalled();

      await act(async () => release());
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(false);
      expect(header(renderer, 'recipe:recipe-2').props.isCollapsed).toBe(true);
      // The tap made while list 2 loaded changed nothing.
      expect(vi.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps folds apart for two accounts on the same shared list', async () => {
    mocks.listInfoState.is_shared = true;
    mocks.collapsedSections = '[]';
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      await act(async () => header(renderer, 'recipe:recipe-1').props.onToggle());
      expect(savedFolds('gacct_a').keys).toEqual(['recipe:recipe-1']);

      // Account B signs in on this device and opens the same shared list. Its
      // widget still shows A's fold until it reconnects.
      mocks.accountScopeId = 'gacct_b';
      mocks.widgetCollapsed = { accountScopeId: 'gacct_a', listId: 'list-1', keys: ['recipe:recipe-1'], updatedAt: Date.now() + 1000 };
      mocks.setWidgetCollapsed.mockClear();
      await act(async () => renderer.render(<GroceryScreen />));
      await act(async () => focusScreen());
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(false);
      expect(checkboxes(renderer)).toHaveLength(4);

      await act(async () => header(renderer, 'recipe:recipe-2').props.onToggle());
      expect(savedFolds('gacct_b').keys).toEqual(['recipe:recipe-2']);
      expect(savedFolds('gacct_a').keys).toEqual(['recipe:recipe-1']);
      // B only ever writes to its own widget view.
      expect(mocks.setWidgetCollapsed.mock.calls.every(([account]) => account === 'gacct_b')).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('moves an old title fold to its section key so a widget tap unfolds it', async () => {
    mocks.storage.set('grocery_collapsed_sections', JSON.stringify(['Chicken Kelaguen']));
    mocks.collapsedSections = 'null';
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(true);
      expect(mocks.storage.has('grocery_collapsed_sections')).toBe(false);
      expect(savedFolds().keys).toEqual(['recipe:recipe-1']);
      // The widget gets the key it matches, not the title.
      expect(mocks.setWidgetCollapsed).toHaveBeenCalledWith('gacct_a', 'list-1', ['recipe:recipe-1'], 0);

      // A tap on the widget header unfolds it there; the app follows.
      mocks.widgetCollapsed = { accountScopeId: 'gacct_a', listId: 'list-1', keys: [], updatedAt: 5000 };
      await act(async () => focusScreen());
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(false);
      expect(savedFolds()).toEqual({ keys: [], updatedAt: 5000 });

      // And folding it again on the widget folds it in the app.
      mocks.widgetCollapsed = { accountScopeId: 'gacct_a', listId: 'list-1', keys: ['recipe:recipe-1'], updatedAt: 6000 };
      await act(async () => focusScreen());
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('forgets folds for groups that leave the list and keeps them through a rename', async () => {
    mocks.collapsedSections = JSON.stringify({ keys: ['recipe:recipe-1', 'recipe:gone'], updatedAt: 10 });
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(savedFolds()).toEqual({ keys: ['recipe:recipe-1'], updatedAt: 10 });

      mocks.groceryState.items = mocks.groceryState.items!.map((entry) =>
        entry.recipe_id === 'recipe-1' ? { ...entry, recipe_title: 'Kelaguen Mannok' } : entry);
      await act(async () => renderer.render(<GroceryScreen />));
      expect(header(renderer, 'recipe:recipe-1').props.isCollapsed).toBe(true);

      mocks.groceryState.items = mocks.groceryState.items!.filter((entry) => entry.recipe_id !== 'recipe-1');
      await act(async () => renderer.render(<GroceryScreen />));
      expect(savedFolds().keys).toEqual([]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('Expand all also unfolds a finished group that To buy hides', async () => {
    mocks.groceryState.items = [
      ...mocks.groceryState.items!,
      item({ id: 'masa', name: 'Masa', checked: true, recipe_id: 'recipe-3', recipe_title: 'Tamales' }),
    ];
    mocks.collapsedSections = JSON.stringify({ keys: ['recipe:recipe-1', 'recipe:recipe-3'], updatedAt: 10 });
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      // A folded group that is all checked keeps its fold while hidden.
      expect(vi.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();
      await act(async () => button(renderer, 'Collapse all recipes').props.onPress());
      expect(savedFolds().keys).toEqual(expect.arrayContaining(['recipe:recipe-1', 'recipe:recipe-2', 'other-items', 'recipe:recipe-3']));
      await act(async () => button(renderer, 'Expand all recipes').props.onPress());
      expect(savedFolds().keys).toEqual([]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('collapses and expands every section from the summary row', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(renderedText(renderer)).toContain('4 items left');
      await act(async () => button(renderer, 'Collapse all recipes').props.onPress());
      expect(checkboxes(renderer)).toHaveLength(0);
      expect(header(renderer, 'other-items').props.isCollapsed).toBe(true);

      await act(async () => button(renderer, 'Expand all recipes').props.onPress());
      expect(checkboxes(renderer)).toHaveLength(4);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('skips the fold animation when Reduce Motion is on', async () => {
    mocks.reduceMotion = true;
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      await act(async () => header(renderer, 'recipe:recipe-1').props.onToggle());
      expect(mocks.configureNext).not.toHaveBeenCalled();
      expect(checkboxes(renderer)).toHaveLength(2);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('unfolds "Other" when adding an item so it appears', async () => {
    mocks.collapsedSections = JSON.stringify({ keys: ['other-items'], updatedAt: 1 });
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(header(renderer, 'other-items').props.isCollapsed).toBe(true);
      await act(async () => renderer.container.queryAll(n => n.type === 'TextInput')[0].props.onChangeText('Eggs'));
      await act(async () => renderer.container.queryAll(n => n.type === 'TextInput')[0].props.onSubmitEditing());
      expect(header(renderer, 'other-items').props.isCollapsed).toBe(false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('offers Undo after checking off an item that To buy then hides', async () => {
    mocks.toggleItem.mockReset();
    mocks.toast.mockReset();
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      await act(async () => checkboxes(renderer)[0].props.onPress());
      const [variables, callbacks] = mocks.toggleItem.mock.calls[0];
      expect(variables).toEqual({ id: 'pork', checked: true });
      await act(async () => callbacks.onSuccess());
      const toast = mocks.toast.mock.calls[0][0];
      expect(toast).toMatchObject({ message: 'Checked off Pork belly', actionLabel: 'Undo' });

      await act(async () => toast.onAction());
      const [undo, undoCallbacks] = mocks.toggleItem.mock.calls[1];
      expect(undo).toEqual({ id: 'pork', checked: false });
      await act(async () => undoCallbacks.onSuccess());
      expect(mocks.toast).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows hand-added items as a plain list with no "Other" header or fold control', async () => {
    mocks.collapsedSections = JSON.stringify({ keys: ['other-items'], updatedAt: 1 });
    mocks.groceryState.items = [
      item({ id: 'rice', name: 'Rice', recipe_id: null, recipe_title: null }),
      item({ id: 'eggs', name: 'Eggs', recipe_id: null, recipe_title: null }),
    ];
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      expect(renderer.container.queryAll((instance) => instance.type === 'GrocerySectionHeader')).toHaveLength(0);
      expect(checkboxes(renderer)).toHaveLength(2);
      expect(button(renderer, 'Collapse all recipes')).toBeUndefined();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

describe('GroceryScreen editing', () => {
  const find = (renderer: ReturnType<typeof createRoot>, label: string) => renderer.container.queryAll(
    (instance) => instance.type === 'TouchableOpacity' && instance.props.accessibilityLabel === label,
  )[0];
  const swipeRow = (renderer: ReturnType<typeof createRoot>, name: string, dx: number) => {
    const row = renderer.container.queryAll((instance) => instance.type === 'NativeView'
      && typeof instance.props.onPanResponderRelease === 'function'
      && instance.queryAll((child) => child.props.accessibilityLabel === `Edit ${name}`).length > 0)[0];
    row.props.onPanResponderRelease({}, { dx, dy: 0 });
  };
  const editSheet = (renderer: ReturnType<typeof createRoot>) => renderer.container.queryAll((instance) => instance.type === 'EditGroceryItemModal')[0];
  const lemons = item({ id: 'lemons', name: 'Lemons', quantity: '4' });

  beforeEach(() => {
    mocks.authState.isLoaded = true;
    mocks.authState.isSignedIn = true;
    mocks.listInfoState.is_shared = false;
    mocks.collapsedSections = '[]';
    mocks.groceryState.items = [lemons, item({ id: 'rice', name: 'Rice', recipe_id: null, recipe_title: null })];
    mocks.alert.mockReset();
    mocks.addItem.mockReset();
    mocks.deleteItem.mockReset();
    mocks.restoreItem.mockReset();
    mocks.toast.mockReset();
    mocks.configureNext.mockClear();
  });

  it('splits an amount and unit from a quick entry', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      const input = () => renderer.container.queryAll((instance) => instance.type === 'TextInput')[0];
      await act(async () => input().props.onChangeText('2 lb chicken thighs'));
      await act(async () => input().props.onSubmitEditing());
      expect(mocks.addItem.mock.calls[0][0]).toEqual({ name: 'chicken thighs', quantity: '2', unit: 'lb' });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('lets the keyboard go: Return on an empty field, and before the editor opens', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      mocks.blurInput.mockClear();
      const input = () => renderer.container.queryAll((instance) => instance.type === 'TextInput')[0];
      await act(async () => input().props.onSubmitEditing());
      expect(mocks.addItem).not.toHaveBeenCalled();
      expect(mocks.blurInput).toHaveBeenCalledOnce();
      // Otherwise iOS refocuses "Add an item" when the sheet closes.
      await act(async () => find(renderer, 'Edit Rice').props.onPress());
      expect(mocks.blurInput).toHaveBeenCalledTimes(2);
      expect(editSheet(renderer).props.item.id).toBe('rice');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('deletes at once and brings the item back with Undo', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      await act(async () => swipeRow(renderer, 'Lemons', -60));
      await act(async () => find(renderer, 'Delete Lemons').props.onPress());
      // No confirmation: the delete goes out and the toast offers the way back.
      expect(mocks.alert).not.toHaveBeenCalled();
      const [id, callbacks] = mocks.deleteItem.mock.calls[0];
      expect(id).toBe('lemons');
      expect(find(renderer, 'Delete Lemons')).toBeUndefined();
      await act(async () => callbacks.onSuccess());
      const toast = mocks.toast.mock.calls[0][0];
      expect(toast).toMatchObject({ message: 'Deleted Lemons', actionLabel: 'Undo' });
      await act(async () => toast.onAction());
      expect(mocks.restoreItem.mock.calls[0][0]).toBe(lemons);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('deletes from the long-press menu and the edit sheet the same way', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      await act(async () => find(renderer, 'Edit Rice').props.onLongPress());
      const menu = mocks.alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
      await act(async () => menu.find((action) => action.text === 'Delete item')!.onPress!());
      expect(mocks.deleteItem.mock.calls[0][0]).toBe('rice');

      await act(async () => find(renderer, 'Edit Lemons').props.onPress());
      expect(editSheet(renderer).props.item.id).toBe('lemons');
      await act(async () => editSheet(renderer).props.onDelete());
      expect(editSheet(renderer).props.visible).toBe(false);
      expect(mocks.deleteItem.mock.calls[1][0]).toBe('lemons');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps one row open, and a tap elsewhere or a scroll closes it', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<GroceryScreen />));
      await act(async () => swipeRow(renderer, 'Lemons', -60));
      expect(find(renderer, 'Delete Lemons')).toBeDefined();
      await act(async () => swipeRow(renderer, 'Rice', -60));
      expect(find(renderer, 'Delete Lemons')).toBeUndefined();
      expect(find(renderer, 'Delete Rice')).toBeDefined();

      // The tap only closes the open row; it doesn't also open the editor.
      await act(async () => find(renderer, 'Edit Lemons').props.onPress());
      expect(find(renderer, 'Delete Rice')).toBeUndefined();
      expect(editSheet(renderer).props.visible).toBe(false);

      await act(async () => swipeRow(renderer, 'Rice', -60));
      const list = renderer.container.queryAll((instance) => instance.type === 'SectionList')[0];
      await act(async () => list.props.onScrollBeginDrag({ nativeEvent: { contentOffset: { y: 0 } } }));
      expect(find(renderer, 'Delete Rice')).toBeUndefined();
      // A short swipe right closes it too.
      await act(async () => swipeRow(renderer, 'Rice', -60));
      await act(async () => swipeRow(renderer, 'Rice', 30));
      expect(find(renderer, 'Delete Rice')).toBeUndefined();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

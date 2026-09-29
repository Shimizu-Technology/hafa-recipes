import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  signedIn: true,
  alert: vi.fn(),
  push: vi.fn(),
  write: vi.fn(async () => undefined),
  copy: vi.fn(),
  scope: 'personal' as 'personal' | 'household',
  items: [] as Array<Record<string, unknown>>,
  personalItems: [] as Array<Record<string, unknown>>,
  copiedIds: [] as string[],
  revision: 4,
}));

const host = vi.hoisted(() => (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode));
vi.mock('react-native', () => ({
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: mocks.alert },
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: host('Modal'),
  Platform: { OS: 'ios' },
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  TextInput: host('TextInput'),
  TouchableOpacity: host('TouchableOpacity'),
  View: host('View'),
}));
vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return { Stack, useRouter: () => ({ push: mocks.push }) };
});
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: mocks.signedIn }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('@/components/Themed', () => ({ Text: host('Text'), useColors: () => ({
  background: '#fff', backgroundSecondary: '#eee', border: '#ccc', card: '#fff', cardBorder: '#ddd',
  text: '#111', textSecondary: '#444', textMuted: '#666', tint: '#165', warning: '#a61', success: '#080',
}) }));
vi.mock('@/constants/Colors', () => ({
  fontSize: { sm: 12, md: 14, lg: 18, xxl: 24 },
  fontWeight: { semibold: '600', bold: '700' },
  radius: { md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/lib/routes', () => ({ appRoutes: { ingredientSearch: '/ingredient-search' } }));
vi.mock('@/hooks/usePantry', () => ({
  usePantrySnapshot: (scope: 'active' | 'personal') => ({
    data: scope === 'active'
      ? { scope: mocks.scope, space_id: 'space-1', revision: mocks.revision, items: mocks.items, copied_personal_item_ids: mocks.copiedIds }
      : { scope: 'personal', items: mocks.personalItems },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePantryWrite: () => ({ isPending: false, mutateAsync: mocks.write, mutate: vi.fn() }),
  useCopyPersonalPantry: () => ({ isPending: false, mutate: mocks.copy }),
}));

import PantryScreen from '../app/pantry';

function findAction(renderer: ReturnType<typeof createRoot>, label: string) {
  return renderer.container.queryAll((node) => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === label)[0];
}

describe('PantryScreen', () => {
  beforeEach(() => {
    mocks.signedIn = true;
    mocks.scope = 'personal';
    mocks.items = [];
    mocks.personalItems = [];
    mocks.copiedIds = [];
    mocks.revision = 4;
    mocks.alert.mockReset();
    mocks.push.mockReset();
    mocks.write.mockReset();
    mocks.write.mockResolvedValue(undefined);
    mocks.copy.mockReset();
  });

  it('edits only changed fields against the revision shown when editing began', async () => {
    mocks.items = [{
      id: 'rice-1', name: 'Rice', quantity: '2', unit: 'cups', location: null,
      date_kind: null, date_value: null, notes: null,
    }];
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(React.createElement(PantryScreen)));
      await act(async () => findAction(renderer, 'Edit Rice').props.onPress());
      mocks.revision = 5;
      const name = renderer.container.queryAll((node) => node.props.accessibilityLabel === 'Item name')[0];
      await act(async () => name.props.onChangeText('Brown rice'));
      const save = renderer.container.queryAll((node) => node.type === 'TouchableOpacity' &&
        node.props.children?.props?.children === 'Save item')[0];
      await act(async () => save.props.onPress());
      expect(mocks.write).toHaveBeenCalledWith({
        operation: 'update', item_id: 'rice-1', changes: { name: 'Brown rice' },
        space_id: 'space-1', base_revision: 4,
      });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('bulk adds pasted names and opens recipe search', async () => {
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(React.createElement(PantryScreen)));
      const input = renderer.container.queryAll((node) => node.props.accessibilityLabel === 'Pantry items to add')[0];
      await act(async () => input.props.onChangeText('Rice, eggs\nrice'));
      await act(async () => findAction(renderer, 'Add pantry items').props.onPress());
      expect(mocks.write).toHaveBeenCalledTimes(2);
      expect(mocks.write).toHaveBeenNthCalledWith(1, { operation: 'add', item: expect.objectContaining({ name: 'Rice' }) });
      expect(mocks.write).toHaveBeenNthCalledWith(2, { operation: 'add', item: expect.objectContaining({ name: 'eggs' }) });
      const findRecipes = renderer.container.queryAll((node) => node.type === 'TouchableOpacity' && node.props.children?.some?.((child: { props?: { children?: string } }) => child?.props?.children === 'Find recipes from my pantry'))[0];
      await act(async () => findRecipes.props.onPress());
      expect(mocks.push).toHaveBeenCalledWith('/ingredient-search');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('offers copying only private lots not already copied', async () => {
    mocks.scope = 'household';
    mocks.personalItems = [
      { id: 'copied', name: 'Rice' },
      { id: 'new', name: 'Eggs' },
    ];
    mocks.copiedIds = ['copied'];
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(PantryScreen)));
      const copy = findAction(renderer, 'Copy private pantry items to household');
      await act(async () => copy.props.onPress());
      expect(mocks.alert).toHaveBeenCalledWith('Copy to household pantry?', expect.stringContaining('Copy your 1 personal item'), expect.any(Array));
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

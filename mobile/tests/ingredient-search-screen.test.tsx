import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  isSignedIn: false,
  groceryPending: false,
  addFromRecipeMutate: vi.fn(),
  alert: vi.fn(),
  refetch: vi.fn(),
  routerPush: vi.fn(),
  searchState: {
    data: undefined as { results: Array<{ recipe: { id: string } }>; total: number } | undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
  },
  useSearchByIngredients: vi.fn(),
}));

function host(name: string) {
  return (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
}

vi.mock('react-native', () => ({
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => mocks.alert(...args) },
  FlatList: ({
    data,
    renderItem,
    ListEmptyComponent,
  }: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    ListEmptyComponent: React.ComponentType;
  }) =>
    React.createElement(
      'FlatList',
      null,
      data.length > 0
        ? data.map((item, index) => React.createElement(
            React.Fragment,
            { key: index },
            renderItem({ item, index }),
          ))
        : React.createElement(ListEmptyComponent),
    ),
  Keyboard: { dismiss: vi.fn() },
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Platform: { OS: 'ios' },
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  TextInput: host('TextInput'),
  TouchableOpacity: host('TouchableOpacity'),
  View: host('NativeView'),
}));

vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return { Stack, useRouter: () => ({ push: mocks.routerPush }) };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: mocks.isSignedIn }) }));
vi.mock('@/components/Themed', () => ({
  Text: host('ThemedText'),
  View: host('ThemedView'),
  useColors: () => ({
    background: '#fff',
    backgroundSecondary: '#eee',
    border: '#ddd',
    card: '#fff',
    cardBorder: '#ddd',
    success: '#080',
    warning: '#b70',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#444',
    tint: '#147a5b',
  }),
}));
vi.mock('@/components/IngredientMatchCard', () => ({
  IngredientMatchCard: host('IngredientMatchCard'),
}));
vi.mock('@/hooks/useRecipes', () => ({
  useSearchByIngredients: (...args: unknown[]) => mocks.useSearchByIngredients(...args),
}));
vi.mock('@/hooks/useGrocery', () => ({
  useAddFromRecipe: () => ({
    isPending: mocks.groceryPending,
    mutate: mocks.addFromRecipeMutate,
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { md: 8, lg: 12, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/utils/haptics', () => ({
  haptics: { light: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/routes', () => ({
  appRoutes: {
    grocery: '/(tabs)/grocery',
    recipe: (id: string) => ({ pathname: '/recipe/[id]', params: { id } }),
  },
}));

import IngredientSearchScreen from '../app/ingredient-search';

function textNodes(renderer: ReturnType<typeof createRoot>, value: string) {
  return renderer.container.queryAll(
    (instance) => instance.type === 'ThemedText' && instance.props.children === value,
  );
}

describe('IngredientSearchScreen', () => {
  beforeEach(() => {
    mocks.isSignedIn = false;
    mocks.groceryPending = false;
    mocks.addFromRecipeMutate.mockReset();
    mocks.alert.mockReset();
    mocks.refetch.mockReset();
    mocks.routerPush.mockReset();
    mocks.searchState.data = undefined;
    mocks.searchState.isLoading = false;
    mocks.searchState.isFetching = false;
    mocks.searchState.isError = false;
    mocks.useSearchByIngredients.mockReset();
    mocks.useSearchByIngredients.mockImplementation(() => ({
      ...mocks.searchState,
      refetch: mocks.refetch,
    }));
  });

  it('keeps a guest pantry search active through a retryable error', async () => {
    const renderer = createRoot({ textComponentTypes: ['ThemedText'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientSearchScreen));
      });
      expect(textNodes(renderer, 'Saved')).toHaveLength(0);

      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      await act(async () => input.props.onChangeText('Chicken, rice'));
      const searchButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Find recipes with these ingredients');
      await act(async () => searchButton!.props.onPress());

      expect(mocks.useSearchByIngredients).toHaveBeenLastCalledWith(
        ['chicken', 'rice'],
        false,
        true,
        true,
      );
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0].props.value).toBe('');
      expect(textNodes(renderer, 'chicken')).toHaveLength(1);
      expect(textNodes(renderer, 'rice')).toHaveLength(1);
      expect(textNodes(renderer, 'Community recipes')).toHaveLength(1);

      mocks.searchState.isError = true;
      mocks.searchState.data = { results: [{ recipe: { id: 'stale-result' } }], total: 1 };
      await act(async () => {
        renderer.render(React.createElement(IngredientSearchScreen));
      });

      expect(textNodes(renderer, 'Couldn’t search recipes').length).toBeGreaterThan(0);
      const retryButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Retry ingredient search',
      )[0];
      await act(async () => retryButton.props.onPress());
      expect(mocks.refetch).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('includes saved recipes in signed-in searches', async () => {
    mocks.isSignedIn = true;
    const renderer = createRoot({ textComponentTypes: ['ThemedText'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientSearchScreen));
      });
      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      await act(async () => input.props.onChangeText('Chicken'));
      const searchButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Find recipes with these ingredients');
      await act(async () => searchButton!.props.onPress());

      expect(textNodes(renderer, 'Saved').length).toBeGreaterThan(0);
      expect(mocks.useSearchByIngredients).toHaveBeenLastCalledWith(
        ['chicken'],
        true,
        true,
        true,
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps oversized pantry searches out of the request', async () => {
    const renderer = createRoot({ textComponentTypes: ['ThemedText'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientSearchScreen));
      });
      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      await act(async () => input.props.onChangeText(
        Array.from({ length: 51 }, (_, index) => `ingredient ${index}`).join(','),
      ));
      const searchButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Find recipes with these ingredients');
      await act(async () => searchButton!.props.onPress());

      expect(mocks.alert).toHaveBeenCalledWith(
        'Too Many Ingredients',
        'Search up to 50 ingredients at a time for the clearest matches.',
      );
      expect(mocks.useSearchByIngredients).toHaveBeenLastCalledWith([], false, true, false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('accepts exactly 50 pantry ingredients', async () => {
    const renderer = createRoot({ textComponentTypes: ['ThemedText'] });
    const ingredients = Array.from({ length: 50 }, (_, index) => `ingredient ${index}`);

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientSearchScreen));
      });
      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      await act(async () => input.props.onChangeText(ingredients.join(',')));
      const searchButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Find recipes with these ingredients');
      await act(async () => searchButton!.props.onPress());

      expect(mocks.alert).not.toHaveBeenCalled();
      expect(mocks.useSearchByIngredients).toHaveBeenLastCalledWith(
        ingredients,
        false,
        true,
        true,
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('adds only a match’s missing ingredients and links to the grocery list', async () => {
    mocks.isSignedIn = true;
    mocks.searchState.data = {
      total: 1,
      results: [{
        recipe: { id: 'recipe-1', title: 'Chicken Kelaguen' },
        matched_ingredients: ['chicken'],
        missing_ingredients: ['lemon', 'green onions'],
        match_count: 1,
        total_ingredients: 3,
        match_percentage: 33.3,
      } as never],
    };
    mocks.addFromRecipeMutate.mockImplementation((
      _variables: unknown,
      callbacks: { onSuccess: () => void; onSettled: () => void },
    ) => {
      callbacks.onSuccess();
      callbacks.onSettled();
    });
    const renderer = createRoot({ textComponentTypes: ['ThemedText'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientSearchScreen));
      });
      const matchCard = renderer.container.queryAll(
        (instance) => instance.type === 'IngredientMatchCard',
      )[0];
      await act(async () => matchCard.props.onAddMissing());

      expect(mocks.addFromRecipeMutate).toHaveBeenCalledWith({
        recipeId: 'recipe-1',
        recipeTitle: 'Chicken Kelaguen',
        ingredients: [
          { name: 'lemon', quantity: null, unit: null, notes: null },
          { name: 'green onions', quantity: null, unit: null, notes: null },
        ],
      }, expect.any(Object));
      const alertButtons = mocks.alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
      await act(async () => alertButtons.find(
        (button) => button.text === 'View grocery list',
      )!.onPress!());
      expect(mocks.routerPush).toHaveBeenCalledWith('/(tabs)/grocery');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('disables every result grocery action while one addition is pending', async () => {
    mocks.isSignedIn = true;
    mocks.groceryPending = true;
    mocks.searchState.data = {
      total: 2,
      results: [
        { recipe: { id: 'recipe-1' } },
        { recipe: { id: 'recipe-2' } },
      ] as never,
    };
    const renderer = createRoot({ textComponentTypes: ['ThemedText'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(IngredientSearchScreen));
      });
      const matchCards = renderer.container.queryAll(
        (instance) => instance.type === 'IngredientMatchCard',
      );

      expect(matchCards).toHaveLength(2);
      expect(matchCards.every(
        (card) => card.props.isGroceryActionDisabled === true,
      )).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

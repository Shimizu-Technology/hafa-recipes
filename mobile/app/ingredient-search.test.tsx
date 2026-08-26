import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isSignedIn: false,
  refetch: vi.fn(),
  searchState: {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
  },
  useSearchByIngredients: vi.fn(),
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);

  return {
    ActivityIndicator: host('ActivityIndicator'),
    FlatList: ({ ListEmptyComponent }: { ListEmptyComponent: React.ComponentType }) =>
      ReactModule.createElement('FlatList', null, ReactModule.createElement(ListEmptyComponent)),
    Image: host('Image'),
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Platform: { OS: 'ios' },
    StyleSheet: { create: <T,>(styles: T) => styles },
    TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});

vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return { Stack, useRouter: () => ({ push: vi.fn() }) };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: mocks.isSignedIn }) }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Text: host('ThemedText'),
    View: host('ThemedView'),
    useColors: () => ({
      background: '#fff',
      backgroundSecondary: '#eee',
      border: '#ddd',
      card: '#fff',
      text: '#111',
      textMuted: '#666',
      tint: '#147a5b',
    }),
  };
});
vi.mock('@/hooks/useRecipes', () => ({
  useSearchByIngredients: (...args: unknown[]) => mocks.useSearchByIngredients(...args),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { md: 8, lg: 12, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/utils/haptics', () => ({ haptics: { light: vi.fn() } }));
vi.mock('@/components/Animated', async () => {
  const ReactModule = await import('react');
  return {
    ScalePressable: (props: Record<string, unknown>) =>
      ReactModule.createElement('ScalePressable', props, props.children as React.ReactNode),
  };
});
vi.mock('@/lib/ingredientSearch', () => ({
  parseIngredientSearchInput: (input: string) =>
    input.split(/[\n,]+/).map((value) => value.trim().toLowerCase()).filter(Boolean),
}));

import IngredientSearchScreen from './ingredient-search';

describe('IngredientSearchScreen', () => {
  beforeEach(() => {
    mocks.isSignedIn = false;
    mocks.refetch.mockReset();
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

  it('hides saved scope for guests and preserves input through a retryable error', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(IngredientSearchScreen));
    });

    expect(renderer!.root.findAllByProps({ children: 'Saved' })).toHaveLength(0);

    const textInputType = 'TextInput' as unknown as React.ComponentType;
    const input = renderer!.root.findByType(textInputType);
    await act(async () => input.props.onChangeText('Chicken, rice'));
    const searchText = renderer!.root.findByProps({ children: 'Search' });
    await act(async () => searchText.parent?.props.onPress());

    expect(mocks.useSearchByIngredients).toHaveBeenLastCalledWith(
      ['chicken', 'rice'],
      true,
      true,
      true,
    );

    mocks.searchState.isError = true;
    await act(async () => renderer!.update(React.createElement(IngredientSearchScreen)));

    expect(renderer!.root.findByType(textInputType).props.value).toBe('Chicken, rice');
    const retryButton = renderer!.root.findByProps({ accessibilityLabel: 'Retry ingredient search' });
    await act(async () => retryButton.props.onPress());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});

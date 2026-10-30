import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToast, runToastAction } from '@/lib/toast';

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
  return { Stack, useRouter: () => ({ push: mocks.routerPush }), useFocusEffect: vi.fn() };
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
vi.mock('@/hooks/usePantry', () => ({
  usePantrySnapshot: () => ({
    data: { scope: 'personal', items: [] },
    isFetched: true,
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
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
    pantry: '/pantry',
    recipe: (id: string) => ({ pathname: '/recipe/[id]', params: { id } }),
  },
}));

vi.mock('@react-native-async-storage/async-storage',()=>{const data=new Map<string,string>();return{default:{getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)},getAllKeys:async()=>[...data.keys()],multiRemove:async(ks:string[])=>{ks.forEach(k=>data.delete(k))}}};});
import {offlineRecipes} from '../lib/offlineRecipes';
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

  it('R4 retires A ingredient search before B hooks receive its private input',async()=>{
    mocks.isSignedIn=true;await offlineRecipes.clear();await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');
    const root=createRoot();
    try{
      await act(async()=>root.render(React.createElement(IngredientSearchScreen)));
      const input=root.container.queryAll(n=>n.type==='TextInput')[0];await act(async()=>input.props.onChangeText('A private pantry ingredient'));
      const search=root.container.queryAll(n=>n.type==='TouchableOpacity'&&n.props.accessibilityLabel==='Find recipes with these ingredients')[0];await act(async()=>search.props.onPress());
      mocks.useSearchByIngredients.mockClear();
      await act(async()=>{await offlineRecipes.verify('subject','owner-b');root.render(React.createElement(IngredientSearchScreen));});
      console.log('R4 B ingredient search hook args',mocks.useSearchByIngredients.mock.calls);
      expect(mocks.useSearchByIngredients.mock.calls.some(([ingredients])=>ingredients.some((value:string)=>value.toLowerCase()==='a private pantry ingredient'))).toBe(false);
    }finally{await act(async()=>root.unmount());await offlineRecipes.clear();}
  });
});

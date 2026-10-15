import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ userId: 'owner-a' }));
const collectionApi = vi.hoisted(() => ({ createCollection: vi.fn(), addRecipeToCollection: vi.fn(), removeRecipeFromCollection: vi.fn() }));
vi.mock('../lib/api', () => ({ api: collectionApi }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: account.userId, isLoaded: true }) }));

import type { CollectionRecipe } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  FlatList: 'FlatList',
  Modal: 'Modal',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  ScrollView: 'ScrollView',
  Platform: { OS: 'web' },
  Keyboard: { dismiss: vi.fn() },
  Image: 'Image',
  RefreshControl: 'RefreshControl',
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('expo-router', () => ({
  Stack: { Screen: 'StackScreen' },
  useLocalSearchParams: () => ({ id: 'collection-1' }),
  useRouter: () => ({ push: vi.fn(), canGoBack: () => false, replace: navigation.replace }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  View: 'View',
  Input: 'Input',
  Button: 'Button',
  useColors: () => ({
    card: '#fff', cardBorder: '#ddd', error: '#b00', text: '#111',
    textMuted: '#666', textSecondary: '#444', tint: '#155c52', warning: '#8a5a00',
  }),
}));
vi.mock('@/components/CreateCollectionModal', () => ({ default: 'CreateCollectionModal' }));
vi.mock('@/hooks/useCollections', () => ({
  useCollectionRecipes: vi.fn(), useCollections: vi.fn(), useRemoveFromCollection: vi.fn(),
  useCreateCollection: vi.fn(), useUpdateCollection: vi.fn(), useDeleteCollection: vi.fn(),
  useRecipeCollections: vi.fn(), useAddToCollection: vi.fn(),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18 },
  fontFamily: { displaySemibold: 'System', semibold: 'System' },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { full: 999, md: 12, lg: 16 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/utils/haptics', () => ({ haptics: { light: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/recipeSource', () => ({
  getRecipeSourcePresentation: () => ({ icon: 'link-outline', label: 'Website' }),
}));
vi.mock('@/components/Animated', () => ({
  AnimatedListItem: 'AnimatedListItem',
  ScalePressable: 'ScalePressable',
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

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
import CollectionScreen, { RecipeCard } from '../app/collection/[id]';
import * as hooks from '@/hooks/useCollections';
const { default: CreateCollectionModal } = await vi.importActual<typeof import('../components/CreateCollectionModal')>('../components/CreateCollectionModal');
import AddToCollectionModal from '../components/AddToCollectionModal';
const actualHooks = await vi.importActual<typeof import('../hooks/useCollections')>('../hooks/useCollections');

const colors = {
  card: '#fff', cardBorder: '#ddd', error: '#b00', text: '#111',
  textMuted: '#666', textSecondary: '#444', tint: '#155c52', warning: '#8a5a00',
} as any;

function recipe(
  reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined,
): CollectionRecipe {
  return {
    id: 'recipe-1',
    title: 'Chicken Kelaguen',
    thumbnail_url: null,
    source_type: 'website',
    tags: [],
    total_time: null,
    servings: null,
    review_state: reviewState,
    added_at: '2026-09-06T00:00:00Z',
  };
}

async function renderCard(reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => {
    renderer.render(React.createElement(RecipeCard, {
      recipe: recipe(reviewState),
      colors,
      onPress: vi.fn(),
      onRemove: vi.fn(),
    }));
  });
  return renderer;
}

describe('collection recipe readiness', () => {
  it.each([
    ['needs_review', 'Recipe needs review'],
    ['source_incomplete', 'Recipe needs source details'],
  ] as const)('renders %s on collection cards', async (state, label) => {
    const renderer = await renderCard(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === label,
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it.each(['ready', undefined] as const)('hides a badge for %s recipes', async (state) => {
    const renderer = await renderCard(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel?.startsWith('Recipe needs'),
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

const collection = { id: 'collection-1', name: 'Dinners', emoji: null, recipe_count: 1, created_at: '', updated_at: '' };
const retryCollections = vi.fn(), retryRecipes = vi.fn(), saveName = vi.fn(), createCollection = vi.fn(), deleteCollection = vi.fn(), addRecipe = vi.fn();
beforeEach(() => {
  account.userId = 'owner-a';
  for (const mock of [navigation.replace, retryCollections, retryRecipes, saveName, createCollection, deleteCollection, addRecipe]) mock.mockReset();
  vi.mocked(Alert.alert).mockClear();
  retryCollections.mockResolvedValue({}); retryRecipes.mockResolvedValue({});
  vi.mocked(hooks.useCollections).mockReturnValue({ data: [collection], refetch: retryCollections } as any);
  vi.mocked(hooks.useCollectionRecipes).mockReturnValue({ data: [recipe('ready')], refetch: retryRecipes } as any);
  vi.mocked(hooks.useRecipeCollections).mockReturnValue({ data: [], refetch: retryRecipes } as any);
  vi.mocked(hooks.useCreateCollection).mockReturnValue({ mutateAsync: createCollection } as any);
  vi.mocked(hooks.useUpdateCollection).mockReturnValue({ mutateAsync: saveName } as any);
  vi.mocked(hooks.useDeleteCollection).mockReturnValue({ mutateAsync: deleteCollection } as any);
  vi.mocked(hooks.useAddToCollection).mockReturnValue({ mutateAsync: addRecipe } as any);
  vi.mocked(hooks.useRemoveFromCollection).mockReturnValue({ mutateAsync: vi.fn() } as any);
});
async function mount(element: React.ReactElement) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => renderer.render(element));
  return renderer;
}
const text = (renderer: ReturnType<typeof createRoot>, value: string) => renderer.container.queryAll((node) => node.props.children === value);
const action = (renderer: ReturnType<typeof createRoot>, title: string) => renderer.container.queryAll((node) => node.props.title === title)[0];
const named = (renderer: ReturnType<typeof createRoot>, label: string) => renderer.container.queryAll((node) => node.props.accessibilityLabel === label)[0];

describe('collection recovery', () => {
  it('shows loading only while collection metadata is still being fetched', async () => {
    vi.mocked(hooks.useCollections).mockReturnValue({ isLoading: true } as any);
    const screen = await mount(<CollectionScreen />);
    try {
      expect(screen.container.queryAll((node) => node.type === 'ActivityIndicator')).toHaveLength(1);
      expect(text(screen, 'Collection unavailable')).toHaveLength(0);
      vi.mocked(hooks.useCollections).mockReturnValue({ data: [], isLoading: false } as any);
      await act(async () => screen.render(<CollectionScreen />));
      expect(screen.container.queryAll((node) => node.type === 'ActivityIndicator')).toHaveLength(0);
    } finally { await act(async () => screen.unmount()); }
  });
  it('retries failed metadata, then replaces a missing-record spinner with library navigation', async () => {
    vi.mocked(hooks.useCollections).mockReturnValue({ isError: true, refetch: retryCollections } as any);
    const screen = await mount(<CollectionScreen />);
    try {
      expect(text(screen, 'Couldn’t load this collection')).toHaveLength(1);
      await act(async () => action(screen, 'Try again').props.onPress());
      expect(retryCollections).toHaveBeenCalledOnce();
      vi.mocked(hooks.useCollections).mockReturnValue({ data: [], refetch: retryCollections } as any);
      await act(async () => screen.render(<CollectionScreen />));
      expect(text(screen, 'Collection unavailable')).toHaveLength(1);
      await act(async () => action(screen, 'Back to library').props.onPress());
      expect(navigation.replace).toHaveBeenCalledWith('/(tabs)/history');
    } finally { await act(async () => screen.unmount()); }
  });
  it('distinguishes a recipe load failure from empty and preserves rows through a refresh error', async () => {
    vi.mocked(hooks.useCollectionRecipes).mockReturnValue({ isError: true, refetch: retryRecipes } as any);
    const screen = await mount(<CollectionScreen />);
    try {
      expect(text(screen, 'Couldn’t load these recipes.')).toHaveLength(1);
      const list = () => screen.container.queryAll((node) => node.type === 'FlatList')[0];
      expect(list().props.ListEmptyComponent).toBeNull();
      const cached = [recipe('ready')];
      vi.mocked(hooks.useCollectionRecipes).mockReturnValue({ data: cached, isError: true, refetch: retryRecipes } as any);
      await act(async () => screen.render(<CollectionScreen />));
      expect(list().props.data).toBe(cached);
      await act(async () => action(screen, 'Try again').props.onPress());
      expect(retryRecipes).toHaveBeenCalledOnce();
      vi.mocked(hooks.useCollectionRecipes).mockReturnValue({ data: cached, refetch: retryRecipes } as any);
      await act(async () => screen.render(<CollectionScreen />));
      expect(text(screen, 'Couldn’t refresh this collection. Your last loaded data is still shown.')).toHaveLength(0);
    } finally { await act(async () => screen.unmount()); }
  });
  it.each([false, true])('preserves failed collection input and retries (editing=%s)', async (editing) => {
    const close = vi.fn();
    const save = editing ? saveName : createCollection;
    const title = editing ? 'Save' : 'Create';
    save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(collection);
    const screen = await mount(<CreateCollectionModal visible onClose={close} editingCollection={editing ? collection : undefined} />);
    try {
      const input = () => screen.container.queryAll((node) => node.props.placeholder === 'e.g., Weeknight Dinners')[0];
      await act(async () => input().props.onChangeText('New dinners'));
      await act(async () => action(screen, title).props.onPress());
      expect(close).not.toHaveBeenCalled(); expect(input().props.value).toBe('New dinners');
      expect(text(screen, 'Couldn’t save this collection. Check your connection and try again.')).toHaveLength(1);
      await act(async () => action(screen, title).props.onPress());
      expect(save).toHaveBeenLastCalledWith(editing ? { collectionId: collection.id, updates: { name: 'New dinners' } } : { name: 'New dinners' });
      expect(close).toHaveBeenCalledOnce();
    } finally { await act(async () => screen.unmount()); }
  });
  it('completes a save through StrictMode effect cleanup and remount', async () => {
    const close = vi.fn();
    createCollection.mockResolvedValue(collection);
    const screen = await mount(<React.StrictMode><CreateCollectionModal visible onClose={close} /></React.StrictMode>);
    try {
      await act(async () => screen.container.queryAll((node) => node.props.placeholder === 'e.g., Weeknight Dinners')[0].props.onChangeText('Dinners'));
      await act(async () => action(screen, 'Create').props.onPress());
      expect(close).toHaveBeenCalledOnce();
    } finally { await act(async () => screen.unmount()); }
  });
  it('explains a failed delete and suppresses late navigation after an account change', async () => {
    const close = vi.fn(), deleted = vi.fn();
    deleteCollection.mockRejectedValueOnce(new Error('offline'));
    const element = () => <CreateCollectionModal visible onClose={close} onDeleted={deleted} editingCollection={collection} />;
    const screen = await mount(element());
    const confirm = () => vi.mocked(Alert.alert).mock.calls.at(-1)![2]!.find((option) => option.text === 'Delete')!.onPress!();
    try {
      await act(async () => named(screen, 'Delete collection').props.onPress());
      await act(async () => confirm());
      expect(deleted).not.toHaveBeenCalled();
      expect(text(screen, 'Couldn’t delete this collection. Check your connection and try again. Your recipes won’t be deleted.')).toHaveLength(1);
      let finish!: () => void;
      deleteCollection.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      await act(async () => named(screen, 'Delete collection').props.onPress());
      let pending: unknown;
      await act(async () => { pending = confirm(); });
      account.userId = 'owner-b';
      await act(async () => screen.render(element()));
      await act(async () => { finish(); await pending; });
      expect(close).not.toHaveBeenCalled(); expect(deleted).not.toHaveBeenCalled();
    } finally { await act(async () => screen.unmount()); }
  });
  it('retries recipe addition after partial creation without creating another collection', async () => {
    createCollection.mockResolvedValue(collection);
    addRecipe.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const screen = await mount(<AddToCollectionModal visible onClose={vi.fn()} recipeId="recipe-1" recipeTitle="Dinner" />);
    try {
      await act(async () => named(screen, 'Create new collection').props.onPress());
      await act(async () => screen.container.queryAll((node) => node.props.placeholder === 'Collection name...')[0].props.onChangeText('Dinners'));
      await act(async () => action(screen, 'Create Collection').props.onPress());
      expect(text(screen, 'Collection created. Couldn’t confirm the recipe was added. Retry adding it.')).toHaveLength(1);
      await act(async () => action(screen, 'Retry adding recipe').props.onPress());
      expect(createCollection).toHaveBeenCalledOnce(); expect(addRecipe).toHaveBeenCalledTimes(2);
      expect(addRecipe).toHaveBeenLastCalledWith({ collectionId: collection.id, recipeId: 'recipe-1' });
    } finally { await act(async () => screen.unmount()); }
  });
  it('rolls back failed membership with a visible explanation', async () => {
    addRecipe.mockRejectedValue(new Error('offline'));
    const screen = await mount(<AddToCollectionModal visible onClose={vi.fn()} recipeId="recipe-1" recipeTitle="Dinner" />);
    try {
      const checkbox = () => screen.container.queryAll((node) => node.props.accessibilityRole === 'checkbox')[0];
      expect(checkbox().props.accessibilityState.checked).toBe(false);
      await act(async () => checkbox().props.onPress());
      expect(checkbox().props.accessibilityState.checked).toBe(false);
      expect(text(screen, 'Couldn’t update this collection. Check your connection and try again.')).toHaveLength(1);
    } finally { await act(async () => screen.unmount()); }
  });
  it('never offers unknown membership as unchecked choices, then preserves cached selections on refresh failure', async () => {
    vi.mocked(hooks.useRecipeCollections).mockReturnValue({ isError: true, refetch: retryRecipes } as any);
    const element = () => <AddToCollectionModal visible onClose={vi.fn()} recipeId="recipe-1" recipeTitle="Dinner" />;
    const screen = await mount(element());
    try {
      const checkbox = () => screen.container.queryAll((node) => node.props.accessibilityRole === 'checkbox')[0];
      expect(checkbox().props.disabled).toBe(true);
      expect(text(screen, 'Couldn’t load your collections. Check your connection and try again.')).toHaveLength(1);
      await act(async () => action(screen, 'Try again').props.onPress());
      expect(retryRecipes).toHaveBeenCalledOnce();
      vi.mocked(hooks.useRecipeCollections).mockReturnValue({ data: [collection.id], isError: true, refetch: retryRecipes } as any);
      await act(async () => screen.render(element()));
      expect(checkbox().props.accessibilityState.checked).toBe(true);
      expect(text(screen, 'Couldn’t refresh your collections. Your last loaded choices are shown.')).toHaveLength(1);
    } finally { await act(async () => screen.unmount()); }
  });
  it('blocks old account dispatch and cache refill after a pending create', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let write!: ReturnType<typeof actualHooks.useCreateCollection>;
    let finish!: (value: typeof collection) => void;
    collectionApi.createCollection.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    function Hook() { write = actualHooks.useCreateCollection(); return null; }
    const element = () => <QueryClientProvider client={client}><Hook /></QueryClientProvider>;
    const screen = await mount(element());
    try {
      let pending!: Promise<unknown>;
      await act(async () => { pending = write.mutateAsync({ name: 'Dinners' }); });
      const guard = collectionApi.createCollection.mock.calls.at(-1)![2];
      account.userId = 'owner-b'; client.clear();
      await act(async () => screen.render(element()));
      expect(() => guard()).toThrow('Account changed');
      await act(async () => { finish(collection); await pending; });
      expect(client.getQueryData(actualHooks.collectionKeys.list('owner-a'))).toBeUndefined();
      expect(client.getQueryData(actualHooks.collectionKeys.list('owner-b'))).toBeUndefined();
    } finally { await act(async () => screen.unmount()); client.clear(); }
  });
  it('does not restore an old account optimistic snapshot into a new account cache', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(actualHooks.collectionKeys.list('owner-a'), [collection]);
    client.setQueryData(actualHooks.collectionKeys.recipeCollections('recipe-1', 'owner-a'), []);
    let write!: ReturnType<typeof actualHooks.useAddToCollection>;
    let fail!: (error: Error) => void;
    collectionApi.addRecipeToCollection.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    function Hook() { write = actualHooks.useAddToCollection(); return null; }
    const element = () => <QueryClientProvider client={client}><Hook /></QueryClientProvider>;
    const screen = await mount(element());
    try {
      let pending!: Promise<unknown>;
      await act(async () => { pending = write.mutateAsync({ collectionId: collection.id, recipeId: 'recipe-1' }).catch(() => undefined); });
      expect(client.getQueryData(actualHooks.collectionKeys.recipeCollections('recipe-1', 'owner-a'))).toEqual([collection.id]);
      account.userId = 'owner-b'; client.clear();
      const other = [{ ...collection, id: 'other', name: 'New account' }];
      client.setQueryData(actualHooks.collectionKeys.list('owner-b'), other);
      await act(async () => screen.render(element()));
      await act(async () => { fail(new Error('offline')); await pending; });
      expect(client.getQueryData(actualHooks.collectionKeys.list('owner-a'))).toBeUndefined();
      expect(client.getQueryData(actualHooks.collectionKeys.list('owner-b'))).toEqual(other);
    } finally { await act(async () => screen.unmount()); client.clear(); }
  });
  it('does not turn unfetched membership or recipe queries into false empty results on removal failure', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let write!: ReturnType<typeof actualHooks.useRemoveFromCollection>;
    collectionApi.removeRecipeFromCollection.mockRejectedValue(new Error('offline'));
    function Hook() { write = actualHooks.useRemoveFromCollection(); return null; }
    const screen = await mount(<QueryClientProvider client={client}><Hook /></QueryClientProvider>);
    try {
      await act(async () => { await write.mutateAsync({ collectionId: collection.id, recipeId: 'recipe-1' }).catch(() => undefined); });
      expect(client.getQueryData(actualHooks.collectionKeys.list('owner-a'))).toBeUndefined();
      expect(client.getQueryData(actualHooks.collectionKeys.recipeCollections('recipe-1', 'owner-a'))).toBeUndefined();
      expect(client.getQueryData(actualHooks.collectionKeys.recipes(collection.id, 'owner-a'))).toBeUndefined();
    } finally { await act(async () => screen.unmount()); client.clear(); }
  });
});

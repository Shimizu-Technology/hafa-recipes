import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ signedIn: true, fetching: false, fetchingNext: false, enabled: false, platform: 'ios', generation: 1, filters: {} as any, push: vi.fn(), next: vi.fn() }));
vi.mock('expo-router', () => ({ Stack: { SearchBar: 'SearchBar' }, useRouter: () => ({ push: state.push }) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: state.signedIn }) }));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', View: 'View', StyleSheet: { create: (s: any) => s, absoluteFill: {} }, Platform: { get OS() { return state.platform; } }, Pressable: 'Pressable', FlatList: ({ data, renderItem, ListHeaderComponent, ...props }: any) => <>{React.createElement('List', props)}{ListHeaderComponent}{data.map((item: any) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)}</> }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/lib/offlineRecipes', () => ({ offlineRecipes: { onRetire: vi.fn() } }));
vi.mock('@/lib/recipeQueryScope', () => ({ recipeScope: () => state.generation }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', Input: 'Input', Button: 'Button', useColors: () => ({}) }));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: 'SignInBanner' }));
vi.mock('@/hooks/useOfflineLease', () => ({ useRecipeOwnerGeneration: () => state.generation }));
vi.mock('@/hooks/useDebouncedSearchQuery', () => ({ useDebouncedSearchQuery: (q: string) => q }));
vi.mock('@/hooks/useRecipes', () => ({ useRecipeCount: () => ({ data: { count: 6 } }), useSearchRecipes: (filters: any, enabled: boolean) => { state.filters = filters; state.enabled = enabled; return { isFetching: state.fetching, isFetchingNextPage: state.fetchingNext, recipes: [{ id: 'recipe-a', is_public: false, thumbnail_url: 'https://images.test/private-a.jpg', title: 'Chicken with herbs', total_time: '30 min' }], hasNextPage: true, fetchNextPage: state.next }; } }));
import SearchRoute from '@/app/(tabs)/search';
beforeEach(() => { state.signedIn = true; state.fetching = false; state.fetchingNext = false; state.next.mockClear(); state.push.mockClear(); });
it('uses native library search, opens results, paginates, and clears query context for the next owner', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<SearchRoute />));
    let bar = r.container.queryAll(n => n.type === 'SearchBar')[0];
    expect(bar.props.placeholder).toBe('Search 6 recipes');
    expect(bar.props.autoFocus).toBe(true);
    await act(async () => bar.props.onChangeText({ nativeEvent: { text: 'Chicken' } }));
    expect(state.filters).toEqual({ query: 'Chicken', ownership: 'all' });
    const result = r.container.queryAll(n => n.props.accessibilityLabel === 'Chicken with herbs')[0];
    await act(async () => result.props.onPress());
    expect(state.push).toHaveBeenCalledWith('/recipe/recipe-a');
    await act(async () => r.container.queryAll(n => n.type === 'List')[0].props.onEndReached());
    expect(state.next).toHaveBeenCalledOnce();
    state.generation++;
    await act(async () => r.render(<SearchRoute />));
    expect(state.filters.query).toBe('');
  } finally { await act(async () => r.unmount()); }
});

it('offers one labelled web search field without an extra native header control', async () => {
  state.platform = 'web';
  const r = createRoot();
  try {
    await act(async () => r.render(<SearchRoute />));
    expect(r.container.queryAll(n => n.type === 'SearchBar')).toHaveLength(0);
    const fields = r.container.queryAll(n => n.type === 'Input');
    expect(fields).toHaveLength(1);
    expect(fields[0].props.accessibilityLabel).toBe('Search library recipes');
    await act(async () => fields[0].props.onChangeText('Chicken'));
    expect(state.filters.query).toBe('Chicken');
  } finally {
    await act(async () => r.unmount());
    state.platform = 'ios';
  }
});

it.each([false, true])('keeps Search rows mounted during a background/next-page fetch (%s)', async nextPage => {
  const r = createRoot();
  try {
    await act(async () => r.render(<SearchRoute />));
    await act(async () => r.container.queryAll(n => n.type === 'SearchBar')[0].props.onChangeText({ nativeEvent: { text: 'Chicken' } }));
    state.fetching = true; state.fetchingNext = nextPage;
    await act(async () => r.render(<SearchRoute />));
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Chicken with herbs')).toHaveLength(1);
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Searching your library')).toHaveLength(0);
    await act(async () => r.container.queryAll(n => n.type === 'List')[0].props.onEndReached());
    expect(state.next).not.toHaveBeenCalled();
    const list = r.container.queryAll(n => n.type === 'List')[0];
    expect(Boolean(list.props.ListFooterComponent)).toBe(nextPage);
  } finally { await act(async () => r.unmount()); }
});
it('does not run a whitespace-only query', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<SearchRoute />));
    await act(async () => r.container.queryAll(n => n.type === 'SearchBar')[0].props.onChangeText({ nativeEvent: { text: '   ' } }));
    expect(state.filters.query).toBe(''); expect(state.enabled).toBe(false);
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Chicken with herbs')).toHaveLength(0);
  } finally { await act(async () => r.unmount()); }
});
it('does not present a searched-empty library or cached rows to a guest', async () => {
  state.signedIn = false;
  const r = createRoot();
  try {
    await act(async () => r.render(<SearchRoute />));
    await act(async () => r.container.queryAll(n => n.type === 'SearchBar')[0].props.onChangeText({ nativeEvent: { text: 'Chicken' } }));
    expect(state.enabled).toBe(false);
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Chicken with herbs')).toHaveLength(0);
    expect(r.container.queryAll(n => n.type === 'Text' && ['My recipes', 'No recipes found.'].includes(n.props.children))).toHaveLength(0);
    expect(r.container.queryAll(n => n.type === 'SignInBanner')).toHaveLength(1);
  } finally { await act(async () => r.unmount()); }
});

it('renders private Search thumbnails through the authority-bound component without a disk cache and retires them for the next owner', async () => {
  const { RecipeThumbnail } = await import('@/components/RecipeThumbnail');
  const r = createRoot();
  try {
    await act(async () => r.render(<SearchRoute />));
    await act(async () => r.container.queryAll(n => n.type === 'SearchBar')[0].props.onChangeText({ nativeEvent: { text: 'Chicken' } }));
    expect(r.container.queryAll(n => n.type === RecipeThumbnail && n.props.uri === 'https://images.test/private-a.jpg')).toHaveLength(1);
    const photo = r.container.queryAll(n => n.type === 'Image' && n.props.source?.uri === 'https://images.test/private-a.jpg')[0];
    expect(photo.props.cachePolicy).toBe('none');
    state.generation++;
    await act(async () => r.render(<SearchRoute />));
    expect(r.container.queryAll(n => n.type === 'Image')).toHaveLength(0);
    expect(state.filters.query).toBe('');
  } finally { await act(async () => r.unmount()); }
});

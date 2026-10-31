import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ generation: 1, filters: {} as any, push: vi.fn(), next: vi.fn() }));
vi.mock('expo-router', () => ({ Stack: { SearchBar: 'SearchBar' }, useRouter: () => ({ push: state.push }) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', View: 'View', Platform: { OS: 'ios' }, Pressable: 'Pressable', FlatList: ({ data, renderItem, ListHeaderComponent, ...props }: any) => <>{React.createElement('List', props)}{ListHeaderComponent}{data.map((item: any) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)}</> }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', Input: 'Input', Button: 'Button', useColors: () => ({}) }));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: 'SignInBanner' }));
vi.mock('@/hooks/useOfflineLease', () => ({ useRecipeOwnerGeneration: () => state.generation }));
vi.mock('@/hooks/useDebouncedSearchQuery', () => ({ useDebouncedSearchQuery: (q: string) => q }));
vi.mock('@/hooks/useRecipes', () => ({ useRecipeCount: () => ({ data: { count: 6 } }), useSearchRecipes: (filters: any) => { state.filters = filters; return { recipes: [{ id: 'recipe-a', title: 'Chicken with herbs', total_time: '30 min' }], hasNextPage: true, fetchNextPage: state.next }; } }));
import SearchRoute from '@/app/(tabs)/search';
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

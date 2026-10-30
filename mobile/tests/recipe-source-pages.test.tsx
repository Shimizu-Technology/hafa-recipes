import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ remove: vi.fn().mockResolvedValue(undefined), removeQueries: vi.fn(), alert: vi.fn(), pages: [{ page: 1, url: 'signed-a' }, { page: 2, url: 'signed-b' }] }));
vi.mock('react-native', () => ({ View: 'View', ScrollView: 'ScrollView', Image: 'Image', Alert: { alert: mocks.alert }, useWindowDimensions: () => ({ width: 390 }) }));
vi.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' }, useLocalSearchParams: () => ({ id: 'recipe' }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { pages: mocks.pages }, isSuccess: true }), useQueryClient: () => ({ removeQueries: mocks.removeQueries }) }));
vi.mock('@/components/Themed', () => ({ Button: 'Button', Text: 'Text', useColors: () => ({ background: '#fff' }) }));
vi.mock('@/hooks/useRecipes', () => ({ useCurrentUserIdentity: () => ({ data: { id: 'owner' } }), useRecipe: () => ({ data: { extracted: { title: 'Family rice', ingredients: [{ name: 'Rice' }], steps: ['Cook rice'] } } }) }));
vi.mock('@/lib/api', () => ({ api: { removeRecipeSourcePages: mocks.remove } }));
import SourcePagesScreen from '@/app/recipe-source-pages';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('shows ordered pages beside extracted content, zooms, and resets zoom when paging', async () => {
  const root = createRoot();
  try {
    await act(async () => root.render(<SourcePagesScreen />));
    const button = (title: string) => root.container.queryAll(n => n.type === 'Button' && n.props.title === title)[0];
    const image = () => root.container.queryAll(n => n.type === 'Image')[0];
    expect(image().props.source.uri).toBe('signed-a');
    const width = image().props.style.width;
    await act(async () => button('Zoom in').props.onPress());
    expect(image().props.style.width).toBe(width * 1.5);
    await act(async () => button('Next page').props.onPress());
    expect(image().props.source.uri).toBe('signed-b');
    expect(image().props.style.width).toBe(width);
    expect(root.container.queryAll(n => n.props.children === 'Family rice')).toHaveLength(1);
    await act(async () => button('Remove pages').props.onPress());
    expect(mocks.remove).not.toHaveBeenCalled();
    await act(async () => mocks.alert.mock.calls.at(-1)![2][1].onPress());
    expect(mocks.remove).toHaveBeenCalledWith('recipe');
    expect(root.container.queryAll(n => n.type === 'Image')).toHaveLength(0);
  } finally { await act(async () => root.unmount()); }
});

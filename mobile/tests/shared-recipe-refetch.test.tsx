import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
vi.mock('expo-router', () => ({
  Redirect: 'Redirect', Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ key: KEY }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'user_a', sessionId: 'sess_a' }) }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', Button: 'Button', useColors: () => ({}) }));
vi.mock('@/components/RecipeDetailRow', () => ({ RecipeDetailRow: 'Row' }));
// The real TanStack query: this test exercises its keep-data-after-refetch-error behavior.
vi.mock('@/hooks/useRecipeQuery', () => ({ useRecipeQuery: useQuery }));
vi.mock('@/hooks/useRecipes', () => ({ recipeKeys: { all: ['recipes'] } }));
vi.mock('@/lib/api', () => ({ api: { getSharedRecipe: m.read }, API_BASE_URL: 'https://api.test' }));
vi.mock('@/lib/openRecipeSource', () => ({ openRecipeSource: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/lib/guestRecipeIntent', () => ({ guestRecipeIntent: { start: vi.fn(), take: () => null } }));
vi.mock('@/hooks/useSaveSharedRecipe', async () => ({
  ...(await vi.importActual<any>('@/hooks/useSaveSharedRecipe')),
  useSaveSharedRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import SharedRecipeScreen from '../app/r/[key]';

const shared = {
  id: '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b', title: 'Sunday Bread', creator: 'Ana', servings: 8, time: '70 min', notes: null, source_url: null,
  components: [{ name: '', ingredients: [{ name: 'flour', quantity: '3', unit: 'cups' }], steps: ['Mix.'] }],
};
const texts = (root: any) => root.container.queryAll((n: any) => n.type === 'Text')
  .map((n: any) => n.children.filter((c: unknown) => typeof c === 'string').join('')).join('\n');

describe('shared recipe after its link is turned off', () => {
  it('stays unavailable through later failed refetches and shows again only after a successful read', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const root = createRoot();
    const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
    const refetch = async () => { await act(async () => { await client.refetchQueries({ queryKey: ['sharedRecipe', KEY] }); }); await settle(); };
    // The screen's own retry policy allows one retry for a 503; let it fail both times.
    m.read.mockResolvedValueOnce(shared);
    await act(async () => root.render(<QueryClientProvider client={client}><SharedRecipeScreen /></QueryClientProvider>));
    await settle();
    expect(texts(root)).toContain('Sunday Bread');

    m.read.mockRejectedValueOnce({ status: 404 });
    await refetch();
    expect(texts(root)).toContain('This recipe isn’t available');
    expect(texts(root)).not.toContain('Sunday Bread');

    m.read.mockRejectedValue({ status: 503 });
    await refetch();
    expect(client.getQueryState(['sharedRecipe', KEY])?.status).toBe('error');
    expect(texts(root)).toContain('This recipe isn’t available');
    expect(texts(root)).not.toContain('Sunday Bread');

    m.read.mockReset();
    m.read.mockResolvedValue(shared);
    await refetch();
    expect(texts(root)).toContain('Sunday Bread');
    expect(texts(root)).not.toContain('This recipe isn’t available');
    await act(async () => root.unmount());
    client.clear();
  });
});

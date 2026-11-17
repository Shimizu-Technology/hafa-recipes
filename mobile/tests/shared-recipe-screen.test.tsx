import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const m = vi.hoisted(() => ({
  replace: vi.fn(), push: vi.fn(), toast: vi.fn(), save: vi.fn(), take: vi.fn(), start: vi.fn(),
  auth: { userId: 'user_a' as string | null, sessionId: 'sess_a' as string | null }, key: '', query: {} as any,
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
vi.mock('expo-router', () => ({
  Redirect: (props: any) => React.createElement('Redirect', props), Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ key: m.key }), useRouter: () => ({ replace: m.replace, push: m.push }),
}));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@clerk/expo', () => ({ useAuth: () => m.auth }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', Button: 'Button', useColors: () => ({}) }));
vi.mock('@/components/RecipeDetailRow', () => ({ RecipeDetailRow: 'Row' }));
vi.mock('@/hooks/useRecipeQuery', () => ({ useRecipeQuery: () => m.query }));
vi.mock('@/hooks/useRecipes', () => ({ recipeKeys: { all: ['recipes'] } }));
vi.mock('@/lib/api', () => ({ api: {}, API_BASE_URL: 'https://api.test' }));
vi.mock('@/lib/openRecipeSource', () => ({ openRecipeSource: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: m.toast }));
vi.mock('@/lib/guestRecipeIntent', () => ({ guestRecipeIntent: { start: m.start, take: m.take } }));
vi.mock('@/hooks/useSaveSharedRecipe', async () => ({
  ...(await vi.importActual<any>('@/hooks/useSaveSharedRecipe')),
  useSaveSharedRecipe: () => ({ mutateAsync: m.save, isPending: false }),
}));

import SharedRecipeScreen from '../app/r/[key]';

const shared = {
  id: '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b', title: 'Sunday Bread', creator: 'Ana', servings: 8, time: '70 min', notes: null,
  source_url: 'https://www.tiktok.com/@thecoreyb/video/7312345678901234567',
  components: [{ name: '', ingredients: [{ name: 'flour', quantity: '3', unit: 'cups' }], steps: ['Mix.'] }],
};
const texts = (root: any) => root.container.queryAll((n: any) => n.type === 'Text')
  .map((n: any) => n.children.filter((c: unknown) => typeof c === 'string').join('')).join('\n');
const button = (root: any, title: string) => root.container.queryAll((n: any) => n.type === 'Button' && n.props.title === title)[0];
const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<SharedRecipeScreen />));
  return root;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.key = KEY;
  m.auth = { userId: 'user_a', sessionId: 'sess_a' };
  m.query = { data: shared, isLoading: false, error: null, refetch: vi.fn(), isFetching: false };
  m.take.mockReturnValue(null);
});

describe('shared recipe view', () => {
  it('sends a recipe ID straight to the recipe screen', async () => {
    m.key = shared.id;
    const root = await render();
    expect(root.container.queryAll((n: any) => n.type === 'Redirect')[0].props.href).toEqual({ pathname: '/recipe/[id]', params: { id: shared.id } });
  });

  it('shows the recipe with credit and saves a private copy, then opens it', async () => {
    m.save.mockResolvedValue({ recipe_id: 'copy-1' });
    const root = await render();
    expect(texts(root)).toContain('TikTok video by @thecoreyb · Shared by Ana');
    expect(texts(root)).toContain('Saves a private copy you can scale, plan and cook from.');
    await act(async () => button(root, 'Save to my library').props.onPress());
    expect(m.save).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith({ message: 'Saved to your library', tone: 'success' });
    expect(m.replace).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'copy-1' } });
  });

  it('asks a guest to sign in and remembers the save in memory', async () => {
    m.auth = { userId: null, sessionId: null };
    const root = await render();
    await act(async () => button(root, 'Sign in to save').props.onPress());
    expect(m.start).toHaveBeenCalledWith(KEY, 'shared-save');
    expect(m.push).toHaveBeenCalledWith('/(auth)/sign-in');
    expect(m.save).not.toHaveBeenCalled();
  });

  it('finishes a save that began before sign-in', async () => {
    const guard = vi.fn();
    m.take.mockReturnValue({ action: 'shared-save', guard });
    m.save.mockResolvedValue({ recipe_id: 'copy-1' });
    await render();
    expect(m.take).toHaveBeenCalledWith(KEY, 'sess_a');
    expect(m.save).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalled();
    expect(m.replace).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'copy-1' } });
  });

  it('offers to open your own recipe instead of saving it again', async () => {
    m.save.mockRejectedValue({ status: 400 });
    const root = await render();
    await act(async () => button(root, 'Save to my library').props.onPress());
    expect(texts(root)).toContain('This is your recipe, so it’s already in your library.');
    await act(async () => button(root, 'Open your recipe').props.onPress());
    expect(m.replace).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: shared.id } });
  });

  it('removes Save when the link no longer opens', async () => {
    m.save.mockRejectedValue({ status: 404 });
    const root = await render();
    await act(async () => button(root, 'Save to my library').props.onPress());
    expect(texts(root)).toContain('the link was turned off');
    expect(button(root, 'Save to my library')).toBeUndefined();
  });

  it('keeps Save available after a rate limit and says when to retry', async () => {
    m.save.mockRejectedValueOnce({ status: 429, retryAfter: 20 }).mockResolvedValueOnce({ recipe_id: 'copy-1' });
    const root = await render();
    await act(async () => button(root, 'Save to my library').props.onPress());
    expect(texts(root)).toContain('Too many saves at once. Try again in 20 seconds.');
    await act(async () => button(root, 'Save to my library').props.onPress());
    expect(m.replace).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'copy-1' } });
  });

  it('explains an unavailable link', async () => {
    m.query = { data: { unavailable: true }, isLoading: false, error: null, refetch: vi.fn(), isFetching: false };
    const root = await render();
    expect(texts(root)).toContain('This recipe isn’t available');
    expect(button(root, 'Save to my library')).toBeUndefined();
  });

  it('says nothing about a sharer who only has a placeholder name', async () => {
    m.query = { ...m.query, data: { ...shared, creator: 'A Håfa cook' } };
    const root = await render();
    expect(texts(root)).toContain('TikTok video by @thecoreyb');
    expect(texts(root)).not.toContain('A Håfa cook');
  });

  it('uses the same stacked row as the share sheet for the original source', async () => {
    const root = await render();
    const original = root.container.queryAll((n: any) => n.type === 'Row' && n.props.title === 'Original')[0];
    expect(original.props).toMatchObject({ stacked: true, value: 'TikTok video by @thecoreyb' });
  });

  it('shows the unavailable state when a refetch 404s, even with the earlier recipe still cached', async () => {
    m.query = { data: { unavailable: true }, isLoading: false, error: null, refetch: vi.fn(), isFetching: false };
    const root = await render();
    expect(texts(root)).toContain('This recipe isn’t available');
    expect(texts(root)).not.toContain('Sunday Bread');
    expect(button(root, 'Save to my library')).toBeUndefined();
  });

  it('keeps component cooking notes, including a component that has only a note', async () => {
    m.query = { ...m.query, data: { ...shared, components: [
      { name: 'Dough', ingredients: [{ name: 'flour', quantity: '3', unit: 'cups' }], steps: ['Mix.'], notes: 'Use bread flour.' },
      { name: 'Resting', ingredients: [], steps: [], notes: 'Chill overnight.' },
    ] } };
    const root = await render();
    expect(texts(root)).toContain('Use bread flour.');
    expect(texts(root)).toContain('Resting');
    expect(texts(root)).toContain('Chill overnight.');
  });

  it('says a rate-limited read is busy, with when to retry, instead of blaming the connection', async () => {
    m.query = { data: undefined, isLoading: false, error: { status: 429, retryAfter: 20 }, refetch: vi.fn(), isFetching: false };
    const root = await render();
    expect(texts(root)).toContain('Too many people opened this link at once. Try again in 20 seconds.');
    expect(texts(root)).not.toContain('Check your connection');
  });
});

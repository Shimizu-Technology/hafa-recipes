import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ values: new Map<string, string>(), request: null as any, response: null as any, finish: null as any }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => state.values.get(key) ?? null,
  setItem: async (key: string, value: string) => { state.values.set(key, value); },
  getAllKeys: async () => [...state.values.keys()], multiRemove: async (keys: string[]) => keys.forEach(key => state.values.delete(key)),
} }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./apiConfig', () => ({ API_BASE_URL: 'https://api.example.test' }));
vi.mock('./sentry', () => ({ addBreadcrumb: vi.fn(), captureError: vi.fn(), captureMessage: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({
  interceptors: { request: { use: (fn: any) => { state.request = fn; } }, response: { use: (fn: any) => { state.response = fn; } } },
  get: async (url: string, config: any = {}) => {
    const request = await state.request({ ...config, url, headers: {}, method: 'get' });
    const data = await new Promise(resolve => { state.finish = resolve; });
    return state.response({ config: request, data });
  },
}) } }));
import { api } from './api';
import { offlineRecipes } from './offlineRecipes';

beforeEach(async () => {
  await offlineRecipes.clear();
  api.setAuthContext(null, 'subject');
  await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject', 'owner-a');
  state.finish = null;
});
it.each(['detail', 'library', 'saved', 'discover', 'note', 'original pages'] as const)(
  'rejects an in-flight %s response at the API boundary after stable-owner change', async kind => {
    const pending = kind === 'detail' ? api.getRecipe('private-a')
      : kind === 'library' ? api.getRecipes() : kind === 'saved' ? api.getSavedRecipes()
      : kind === 'discover' ? api.getPublicRecipes() : kind === 'note' ? api.getRecipeNote('private-a')
      : api.getRecipeSourcePages('private-a');
    const rejection = expect(pending).rejects.toThrow('account');
    await vi.waitFor(() => expect(state.finish).toBeTypeOf('function'));
    await offlineRecipes.verify('subject', 'owner-b');
    state.finish({ id: 'private-a', is_owner: true, extracted: { title: 'A private response' } });
    await rejection;
    expect(await offlineRecipes.list(offlineRecipes.lease('subject')!)).toEqual([]);
  },
);

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // QueryCore only schedules browser polling when window exists.
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  return {
    getRecipe: vi.fn(), getRecipes: vi.fn(), getPublicRecipes: vi.fn(), checkRecipeSaved: vi.fn(),
    userId: 'account-a' as string | null,
    isLoaded: true,
    appState: 'active',
    initiallyConnected: true,
    appListener: null as null | ((state: string) => void),
    networkListener: null as null | ((state: { isConnected: boolean; isInternetReachable: boolean }) => void),
    removeAppListener: vi.fn(),
    removeNetworkListener: vi.fn(),
  };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../utils/haptics', () => ({ haptics: { success: vi.fn() } }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: mocks.isLoaded, userId: mocks.userId }) }));
vi.mock('@react-native-async-storage/async-storage', () => { const values = new Map<string,string>(); return { default: {
getItem: async (k:string) => values.get(k) ?? null,
setItem: async (k:string,v:string) => { values.set(k,v); },
getAllKeys: async () => [...values.keys()], multiRemove: async (ks:string[]) => { ks.forEach(k=>values.delete(k)); }
} }; });
vi.mock('../lib/api', () => ({ api: { getRecipe: mocks.getRecipe, getRecipes: mocks.getRecipes, getPublicRecipes: mocks.getPublicRecipes, checkRecipeSaved: mocks.checkRecipeSaved } }));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return mocks.appState; },
  addEventListener: (_event: string, callback: (state: string) => void) => {
    mocks.appListener = callback;
    return { remove: mocks.removeAppListener };
  },
} }));
vi.mock('@react-native-community/netinfo', () => ({ default: {
  addEventListener: (callback: typeof mocks.networkListener) => {
    mocks.networkListener = callback;
    callback?.({ isConnected: mocks.initiallyConnected, isInternetReachable: mocks.initiallyConnected });
    return mocks.removeNetworkListener;
  },
} }));

import { recipeKeys, useRecipe, useRecipes, useDiscoverRecipes, useIsRecipeSaved } from './useRecipes';
import type { Recipe } from '../types/recipe';

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
let result: ReturnType<typeof useRecipe>;
const base = { id: 'recipe-a', thumbnail_url: null, content_revision: 1 } as unknown as Recipe;
const pending = (milliseconds = 60_000) => ({
  ...base,
  thumbnail_pending: true,
  thumbnail_pending_until: new Date(Date.now() + milliseconds).toISOString(),
});
function Harness() { result = useRecipe('recipe-a'); return null; }
const tree = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
async function flush(ms = 10) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function mount() {
  await act(async () => { renderer = create(tree()); });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
  for (const name of ['getRecipe', 'getRecipes', 'getPublicRecipes', 'checkRecipeSaved'] as const) mocks[name].mockReset();
  mocks.userId = 'account-a';
  mocks.isLoaded = true;
  mocks.appState = 'active';
  mocks.initiallyConnected = true;
  mocks.appListener = null;
  mocks.networkListener = null;
  mocks.removeAppListener.mockClear();
  mocks.removeNetworkListener.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 10, gcTime: Infinity } } });
});
afterEach(async () => {
  if (renderer) await act(async () => { renderer!.unmount(); });
  renderer = undefined;
  client.clear();
  await offlineRecipes.clear();
  vi.useRealTimers();
});

import { offlineRecipes } from '../lib/offlineRecipes';
it('R2 hides query-backed private content offline after the same subject changes stable owner', async () => {
 await offlineRecipes.bindSubject('account-a'); await offlineRecipes.verify('account-a','owner-a');
 const privateA = {...base, is_owner:true, is_public:false, extracted:{title:'A secret',ingredients:[],steps:['Private']}} as unknown as Recipe;
 mocks.getRecipe.mockResolvedValue(privateA);
 await mount();
 expect(result.data?.extracted.title).toBe('A secret');
 await act(async () => { mocks.networkListener?.({isConnected:false,isInternetReachable:false}); });
 await act(async () => { await offlineRecipes.verify('account-a','owner-b'); });
 expect(await offlineRecipes.list(offlineRecipes.lease('account-a')!)).toEqual([]);
 expect(result.data).toBeUndefined();
 await offlineRecipes.clear();
});
it('R2 rejects an in-flight private response from the retired stable owner',async()=>{
 await offlineRecipes.bindSubject('account-a');await offlineRecipes.verify('account-a','owner-a');
 let finish!:(value:Recipe)=>void;
 mocks.getRecipe.mockImplementationOnce(()=>new Promise<Recipe>(resolve=>{finish=resolve})).mockImplementation(() => new Promise<Recipe>(() => {}));
 await mount();
 expect(mocks.getRecipe).toHaveBeenCalledTimes(1);
 await act(async()=>{await offlineRecipes.verify('account-a','owner-b')});
 await act(async()=>finish({...base,is_owner:true,is_public:false,extracted:{title:'A late secret',ingredients:[],steps:['Private']}} as unknown as Recipe));
 await flush();
 expect(result.data).toBeUndefined();
});

it('retires mounted Detail, Cook Mode, Library and Discover saved state before owner cleanup awaits disk', async () => {
  await offlineRecipes.bindSubject('account-a'); await offlineRecipes.verify('account-a', 'owner-a');
  const secret = { ...base, is_owner: true, extracted: { title: 'A secret', components: [{ steps: ['A private instruction'] }] } } as unknown as Recipe;
  const page = { items: [{ id: base.id, title: 'A secret', is_saved: true }], total: 1, has_more: false, offset: 0, limit: 20 };
  mocks.getRecipe.mockResolvedValueOnce(secret);
  mocks.getRecipes.mockResolvedValueOnce(page);
  mocks.getPublicRecipes.mockResolvedValueOnce(page);
  mocks.checkRecipeSaved.mockResolvedValueOnce({ is_saved: true });
  let detail!: ReturnType<typeof useRecipe>, cook!: ReturnType<typeof useRecipe>;
  let library!: ReturnType<typeof useRecipes>, discover!: ReturnType<typeof useDiscoverRecipes>;
  let saved!: ReturnType<typeof useIsRecipeSaved>;
  function MountedScreens() {
    detail = useRecipe(base.id); cook = useRecipe(base.id);
    library = useRecipes(); discover = useDiscoverRecipes(); saved = useIsRecipeSaved(base.id);
    return null;
  }
  await act(async () => { renderer = create(<QueryClientProvider client={client}><MountedScreens /></QueryClientProvider>); });
  await flush();
  expect(detail.data?.extracted.title).toBe('A secret');
  expect(cook.data?.extracted.components[0].steps[0]).toBe('A private instruction');
  expect(library.recipes[0].title).toBe('A secret');
  expect(discover.recipes[0].is_saved).toBe(true); expect(saved.data?.is_saved).toBe(true);
  for (const name of ['getRecipe', 'getRecipes', 'getPublicRecipes', 'checkRecipeSaved'] as const) mocks[name].mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    const changed = offlineRecipes.verify('account-a', 'owner-b');
    // No promise has settled and no disk cleanup has run yet.
    expect(client.getQueryCache().findAll().filter(query => query.state.data !== undefined)).toEqual([]);
    await changed;
  });
  await flush();
  expect(detail.data).toBeUndefined(); expect(cook.data).toBeUndefined();
  expect(library.recipes).toEqual([]); expect(discover.recipes).toEqual([]); expect(saved.data).toBeUndefined();
  expect(detail.preview).toBeNull();
  expect(await offlineRecipes.list(offlineRecipes.lease('account-a')!)).toEqual([]);
});

it('drops an owner A card preview and rejects late Library and Discover pages in mounted observers', async () => {
  await offlineRecipes.bindSubject('account-a'); await offlineRecipes.verify('account-a', 'owner-a');
  const oldKey = recipeKeys.infinite();
  client.setQueryData(oldKey, { pages: [{ items: [{ id: base.id, title: 'A private preview' }] }], pageParams: [0] }, { updatedAt: 1 });
  mocks.getRecipe.mockImplementation(() => new Promise(() => {}));
  const pending: Array<(value: any) => void> = [];
  for (const name of ['getRecipes', 'getPublicRecipes'] as const) {
    mocks[name].mockImplementationOnce(() => new Promise(resolve => pending.push(resolve)))
      .mockImplementation(() => new Promise(() => {}));
  }
  let library!: ReturnType<typeof useRecipes>, discover!: ReturnType<typeof useDiscoverRecipes>;
  function MountedFeeds() { result = useRecipe(base.id); library = useRecipes(); discover = useDiscoverRecipes(); return null; }
  await act(async () => { renderer = create(<QueryClientProvider client={client}><MountedFeeds /></QueryClientProvider>); });
  await flush(); expect(result.preview?.title).toBe('A private preview');
  await act(async () => { await offlineRecipes.verify('account-a', 'owner-b'); });
  expect(recipeKeys.infinite()).not.toEqual(oldKey); expect(client.getQueryData(oldKey)).toBeUndefined();
  await act(async () => { pending.forEach(finish => finish({ items: [{ id: base.id, title: 'A late secret', is_saved: true }], has_more: false })); });
  await flush();
  expect(result.preview).toBeNull(); expect(result.data).toBeUndefined();
  expect(library.recipes).toEqual([]); expect(discover.recipes).toEqual([]);
  expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain('A late secret');
});

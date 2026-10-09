import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // QueryCore only schedules browser polling when window exists.
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  return {
    getRecipe: vi.fn(),
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
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: mocks.isLoaded, userId: mocks.userId }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('../lib/api', () => ({ api: { getRecipe: mocks.getRecipe } }));
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

import { recipeKeys, useRecipe } from './useRecipes';
import type { Recipe } from '../types/recipe';

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
let result: ReturnType<typeof useRecipe>;
const base = { id: 'recipe-a', thumbnail_url: null, content_revision: 1 } as Recipe;
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
  mocks.getRecipe.mockReset();
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
  vi.useRealTimers();
});

describe('recipe cover refresh', () => {
  it('polls pending photos, updates the mounted detail, and invalidates card feeds once', async () => {
    const feeds = [recipeKeys.infinite(), recipeKeys.recent(), recipeKeys.savedInfinite(), recipeKeys.discoverFeed(), recipeKeys.infiniteSearch({ query: 'chicken' })];
    feeds.forEach((key) => client.setQueryData(key, { thumbnail_url: null }));
    mocks.getRecipe.mockResolvedValueOnce(pending()).mockResolvedValue({ ...base, thumbnail_url: 'https://images/food.webp', thumbnail_pending: false });
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    await mount();
    expect(result.thumbnailPending).toBe(true);
    await flush(3_010);
    expect(result.data?.thumbnail_url).toBe('https://images/food.webp');
    expect(result.thumbnailPending).toBe(false);
    expect(invalidation).toHaveBeenCalledTimes(1);
    feeds.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(client.getQueryState(recipeKeys.detail('recipe-a'))?.isInvalidated).toBe(false);
    await flush(10_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(2);
  });

  it.each([base, { ...base, thumbnail_pending: false }, { ...base, thumbnail_pending: true }, { ...base, thumbnail_pending: true, thumbnail_pending_until: 'invalid' }])('supports old or terminal API responses without polling (%j)', async (recipe) => {
    mocks.getRecipe.mockResolvedValue(recipe);
    await mount();
    await flush(10_000);
    expect(result.thumbnailPending).toBe(false);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(1);
  });

  it('expires the status and polling at the deadline while retaining the saved recipe', async () => {
    mocks.getRecipe.mockResolvedValue(pending(1_000));
    await mount();
    expect(result.thumbnailPending).toBe(true);
    await flush(1_010);
    expect(result.thumbnailPending).toBe(false);
    await flush(10_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(1);
    expect(result.data?.id).toBe('recipe-a');
  });

  it('caps an unexpectedly distant server deadline at five minutes', async () => {
    mocks.getRecipe.mockResolvedValue(pending(60 * 60_000));
    await mount();
    await flush(5 * 60_000 + 20);
    expect(result.thumbnailPending).toBe(false);
    const calls = mocks.getRecipe.mock.calls.length;
    await flush(30_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(calls);
  });

  it('pauses while backgrounded or offline and resumes when visible and online', async () => {
    mocks.getRecipe.mockResolvedValue(pending());
    await mount();
    await act(async () => { mocks.appListener?.('background'); });
    await flush(6_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(1);
    await act(async () => { mocks.networkListener?.({ isConnected: false, isInternetReachable: false }); mocks.appListener?.('active'); });
    await flush(6_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(1);
    await act(async () => { mocks.networkListener?.({ isConnected: true, isInternetReachable: true }); });
    await flush();
    expect(mocks.getRecipe.mock.calls.length).toBeGreaterThan(1);
  });

  it.each(['offline', 'background'] as const)('does not fetch initially while %s', async (state) => {
    if (state === 'offline') mocks.initiallyConnected = false;
    if (state === 'background') mocks.appState = 'background';
    mocks.getRecipe.mockResolvedValue(base);
    await mount();
    await flush(9_000);
    expect(mocks.getRecipe).not.toHaveBeenCalled();
  });

  it.each([true, false])('waits for cold-start auth without hiding the known offline state (connected=%s)', async (connected) => {
    mocks.isLoaded = false;
    mocks.userId = null;
    mocks.initiallyConnected = connected;
    mocks.getRecipe.mockResolvedValue(base);
    await mount();
    expect(mocks.getRecipe).not.toHaveBeenCalled();
    expect(result.isLoading).toBe(connected);
    await flush(9_000);
    expect(mocks.getRecipe).not.toHaveBeenCalled();
    mocks.isLoaded = true;
    mocks.userId = 'account-a';
    await act(async () => renderer!.update(tree()));
    await flush();
    if (!connected) {
      expect(result.isLoading).toBe(false);
      expect(mocks.getRecipe).not.toHaveBeenCalled();
      await act(async () => mocks.networkListener?.({ isConnected: true, isInternetReachable: true }));
      await flush();
    }
    expect(mocks.getRecipe).toHaveBeenCalledTimes(1);
    expect(result.data?.id).toBe('recipe-a');
    expect(result.isLoading).toBe(false);
  });

  it('stops after repeated transport failures and leaves the cached recipe visible', async () => {
    mocks.getRecipe.mockResolvedValueOnce(pending()).mockRejectedValue(new Error('Network Error'));
    await mount();
    await flush(3_050);
    await flush(30_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(3); // One successful fetch and one retry.
    expect(result.data?.id).toBe('recipe-a');
    expect(result.error).toBeTruthy();
  });

  it('deduplicates an in-flight poll and aborts it and subscriptions on unmount', async () => {
    mocks.getRecipe.mockResolvedValueOnce(pending()).mockImplementation(() => new Promise(() => undefined));
    await mount();
    await flush(3_010);
    await flush(9_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(2);
    const signal = mocks.getRecipe.mock.calls[1][1] as AbortSignal;
    await act(async () => { renderer!.unmount(); });
    renderer = undefined;
    expect(signal.aborted).toBe(true);
    expect(mocks.removeAppListener).toHaveBeenCalledTimes(1);
    expect(mocks.removeNetworkListener).toHaveBeenCalledTimes(1);
    await flush(9_000);
    expect(mocks.getRecipe).toHaveBeenCalledTimes(2);
  });

  it('defers feed requests if a photo finishes after the app enters the background', async () => {
    let resolvePhoto!: (recipe: Recipe) => void;
    mocks.getRecipe.mockResolvedValueOnce(pending()).mockImplementationOnce(() => new Promise<Recipe>((resolve) => { resolvePhoto = resolve; }));
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    await mount();
    await flush(3_010);
    await act(async () => { mocks.appListener?.('background'); });
    await act(async () => { resolvePhoto({ ...base, thumbnail_pending: false, thumbnail_url: 'https://images/food.webp' }); });
    await flush();
    expect(invalidation).not.toHaveBeenCalled();
    mocks.getRecipe.mockResolvedValue({ ...base, thumbnail_pending: false, thumbnail_url: 'https://images/food.webp' });
    await act(async () => { mocks.appListener?.('active'); });
    await flush();
    expect(invalidation).toHaveBeenCalledTimes(1);
  });

  it('lets another mounted detail finish a shared request when its first observer unmounts', async () => {
    let resolvePhoto!: (recipe: Recipe) => void;
    mocks.getRecipe.mockResolvedValueOnce(pending()).mockImplementationOnce(() => new Promise<Recipe>((resolve) => { resolvePhoto = resolve; }));
    let showFirst = true;
    function SharedHarness() { return <>{showFirst && <Harness key="first" />}<Harness key="second" /></>; }
    const sharedTree = () => <QueryClientProvider client={client}><SharedHarness /></QueryClientProvider>;
    await act(async () => { renderer = create(sharedTree()); });
    await flush();
    await flush(3_010);
    showFirst = false;
    await act(async () => { renderer!.update(sharedTree()); });
    await act(async () => { resolvePhoto({ ...base, thumbnail_pending: false, thumbnail_url: 'https://images/food.webp' }); });
    await flush();
    expect(result.data?.thumbnail_url).toBe('https://images/food.webp');
    expect(mocks.getRecipe).toHaveBeenCalledTimes(2);
  });

  it('rejects a late response from the prior account without updating feeds', async () => {
    let resolveOld!: (recipe: Recipe) => void;
    mocks.getRecipe.mockResolvedValueOnce(pending()).mockImplementationOnce(() => new Promise<Recipe>((resolve) => { resolveOld = resolve; }));
    await mount();
    await flush(3_010);
    mocks.userId = 'account-b';
    await act(async () => { renderer!.update(tree()); });
    await act(async () => { resolveOld({ ...base, thumbnail_url: 'https://images/account-a.webp' }); });
    await flush();
    expect(result.data?.thumbnail_url).toBeNull();
    expect(result.error?.name).toBe('CaptureAccountChangedError');
  });
});

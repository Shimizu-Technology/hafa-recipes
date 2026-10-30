import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSaveRecipe, useUnsaveRecipe, recipeKeys } from './useRecipes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({ subject: 'viewer', scope: { userId: 'viewer', epoch: 0 }, save: vi.fn(), unsave: vi.fn(), reconcile: vi.fn(), toast: vi.fn(), success: vi.fn() }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: m.subject }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-native', () => ({ AppState: {} }));
vi.mock('../lib/api', () => ({ api: { saveRecipe: m.save, unsaveRecipe: m.unsave, getAuthScope: () => m.scope } }));
vi.mock('../lib/recipeCache', async (original) => ({ ...await original<typeof import('../lib/recipeCache')>(), reconcileSavedStateAfterError: m.reconcile }));
vi.mock('../lib/toast', () => ({ showToast: m.toast }));
vi.mock('../utils/haptics', () => ({ haptics: { success: m.success } }));

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
async function mount(saved = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['recipeSaved', 'recipe-1'], { is_saved: saved });
  let mutation!: ReturnType<typeof useSaveRecipe>;
  function Probe() { mutation = saved ? useUnsaveRecipe() : useSaveRecipe(); return null; }
  const r = createRoot();
  await act(async () => r.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  return { client, r, get mutation() { return mutation; }, async close() { await act(async () => r.unmount()); client.clear(); } };
}
beforeEach(() => { vi.clearAllMocks(); m.subject='viewer'; m.scope={ userId: 'viewer', epoch: 0 }; m.reconcile.mockResolvedValue(undefined); });

describe('confirmed recipe saving', () => {
  it.each(['success', 'failure'] as const)('ignores a late %s after unmount and an account transition', async (outcome) => {
    const d = deferred<{ saved: boolean }>(); m.save.mockReturnValue(d.promise);
    const h = await mount();
    await act(async () => h.mutation.mutate('recipe-1'));
    await act(async () => h.r.unmount());
    m.scope={ userId: 'another-viewer', epoch: 1 };
    h.client.clear(); h.client.setQueryData(['recipeSaved', 'recipe-1'], { is_saved: false });
    await act(async () => { if (outcome === 'success') d.resolve({ saved: true }); else d.reject(new Error('late failure')); });
    expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: false });
    expect(m.success).not.toHaveBeenCalled(); expect(m.toast).not.toHaveBeenCalled(); expect(m.reconcile).not.toHaveBeenCalled();
    h.client.clear();
  });

  it('settles the same account cache after navigation without off-screen feedback', async () => {
    const d = deferred<{ saved: boolean }>(); m.save.mockReturnValue(d.promise);
    const h = await mount();
    await act(async () => h.mutation.mutate('recipe-1'));
    await act(async () => h.r.unmount());
    await act(async () => d.resolve({ saved: true }));
    expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: true });
    expect(m.success).not.toHaveBeenCalled(); h.client.clear();
  });

  it('rejects Retry after signing out and back into the same subject', async () => {
    m.save.mockRejectedValue(new Error('offline')); const h = await mount();
    await act(async () => { await h.mutation.mutateAsync('recipe-1').catch(() => {}); });
    const retry = m.toast.mock.calls[0][0].onAction;
    m.scope={ userId: 'viewer', epoch: 2 };
    await act(async () => retry());
    expect(m.save).toHaveBeenCalledOnce(); await h.close();
  });

  it.each([false, true])('holds the settled state until the server confirms (initial saved=%s)', async (initial) => {
    const d = deferred<{ saved: boolean }>(); (initial ? m.unsave : m.save).mockReturnValue(d.promise);
    const h = await mount(initial);
    await act(async () => h.mutation.mutate('recipe-1'));
    expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: initial });
    expect(m.success).not.toHaveBeenCalled();
    await act(async () => d.resolve({ saved: !initial }));
    expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: !initial });
    expect(m.success).toHaveBeenCalledOnce();
    await h.close();
  });

  it('reconciles an ambiguous failure before showing Retry for the same operation', async () => {
    m.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ saved: true });
    const h = await mount();
    await act(async () => { await h.mutation.mutateAsync('recipe-1').catch(() => {}); });
    expect(m.reconcile).toHaveBeenCalledWith(h.client, 'recipe-1', expect.any(Function), expect.any(Function));
    expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: false });
    expect(m.success).not.toHaveBeenCalled();
    const toast = m.toast.mock.calls[0][0];
    expect(toast).toMatchObject({ message: "Couldn't save. Try again", actionLabel: 'Retry', tone: 'error' });
    await act(async () => toast.onAction());
    expect(m.save).toHaveBeenCalledTimes(2);
    expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: true });
    await h.close();
  });

  it('does not replay a persistent Retry into a different account', async () => {
    m.save.mockRejectedValue(new Error('offline')); const h = await mount();
    await act(async () => { await h.mutation.mutateAsync('recipe-1').catch(() => {}); });
    const retry = m.toast.mock.calls[0][0].onAction;
    m.subject='another-viewer';
    await act(async () => h.r.render(<QueryClientProvider client={h.client}><ProbeAgain /></QueryClientProvider>));
    function ProbeAgain() { useSaveRecipe(); return null; }
    // The original hook is unmounted. A stale action must not perform a write.
    await act(async () => retry());
    expect(m.save).toHaveBeenCalledOnce();
    await h.close();
  });
});

it.each([false, true])('protects confirmed membership from reads before and during the write (initial saved=%s)', async (initial) => {
  const h = await mount(initial);
  const key = recipeKeys.discoverFeed(undefined, 'recent', undefined);
  const oldPage = { pages: [{ items: [{ id: 'recipe-1', is_saved: initial }], total: 1, offset: 0, limit: 20 }], pageParams: [0] };
  h.client.setQueryData(key, oldPage);
  const reads: Promise<unknown>[] = [];
  const pending: { resolve: (v: any) => void }[] = [];
  const startReads = () => {
    const discover = deferred<typeof oldPage>(); const status = deferred<{ is_saved: boolean }>();
    pending.push(discover, status);
    reads.push(h.client.fetchQuery({ queryKey: key, queryFn: () => discover.promise }).catch(() => {}),
      h.client.fetchQuery({ queryKey: ['recipeSaved', 'recipe-1'], queryFn: () => status.promise }).catch(() => {}));
  };
  startReads();
  const write = deferred<{ saved: boolean }>(); (initial ? m.unsave : m.save).mockReturnValue(write.promise);
  await act(async () => h.mutation.mutate('recipe-1'));
  // Reads begun while the request is in flight need cancellation at success too.
  startReads();
  await act(async () => write.resolve({ saved: !initial }));
  expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: !initial });
  await act(async () => { pending.forEach((d, i) => d.resolve(i % 2 ? { is_saved: initial } : oldPage)); await Promise.all(reads); });
  expect(h.client.getQueryData(['recipeSaved', 'recipe-1'])).toEqual({ is_saved: !initial });
  expect((h.client.getQueryData(key) as any).pages[0].items[0].is_saved).toBe(!initial);
  expect(h.client.getQueryState(key)?.isInvalidated).toBe(true);
  await h.close();
});

it('invalidates filtered Library roots after confirmed membership changes', async () => {
  const h = await mount();
  const key = recipeKeys.infiniteSearch({ ownership: 'saved', query: 'rice' });
  h.client.setQueryData(key, { pages: [], pageParams: [] });
  m.save.mockResolvedValue({ saved: true });
  await act(async () => { await h.mutation.mutateAsync('recipe-1'); });
  expect(h.client.getQueryState(key)?.isInvalidated).toBe(true);
  await h.close();
});

it('freezes Save authority before asynchronous cache cancellation', async () => {
  const h = await mount(); const pause = deferred<void>();
  vi.spyOn(h.client, 'cancelQueries').mockReturnValue(pause.promise);
  const pending = h.mutation.mutateAsync('recipe-1').catch(error => error);
  m.scope = { userId: 'other', epoch: 1 }; pause.resolve();
  await act(async () => { await pending; });
  expect(m.save).not.toHaveBeenCalled(); expect(m.reconcile).not.toHaveBeenCalled();
  await h.close();
});

it('carries the same intent guard through dispatch and a labelled Retry', async () => {
  const { createGuestRecipeIntent } = await import('../lib/guestRecipeIntent');
  const intent = createGuestRecipeIntent(); intent.start('recipe-1', 'save'); intent.bind('session-a');
  const consumed = intent.take('recipe-1', 'session-a')!;
  m.save.mockRejectedValue(new Error('lost response'));
  const h = await mount();
  await act(async () => { await h.mutation.mutateAsync('recipe-1', undefined, consumed.guard).catch(() => {}); });
  const requestGuard = m.save.mock.calls.at(-1)![1]; expect(requestGuard).toBeTypeOf('function');
  expect(m.toast.mock.calls.at(-1)![0].actionLabel).toBe('Retry');
  intent.bind('session-b'); expect(() => requestGuard()).toThrow();
  await act(async () => m.toast.mock.calls.at(-1)![0].onAction());
  expect(m.save).toHaveBeenCalledOnce(); await h.close();
});

// Creation must invalidate the same scoped pages the picker consumes.
it('invalidates cached planner search pages after capture creation', async () => {
  const { invalidateCreatedRecipeQueries } = await import('./useRecipes');
  const client = new QueryClient();
  const key = ['recipes', 'plannerSearch', 'all', { query: 'rice' }];
  client.setQueryData(key, { pages: [] });
  invalidateCreatedRecipeQueries(client, 'created');
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

it('invalidates a previously opened Saved planner page after Save and Unsave', async () => {
  for (const initial of [false, true]) {
    const h = await mount(initial);
    const key = [...recipeKeys.all, 'plannerSearch', 'saved', { query: 'rice' }];
    h.client.setQueryData(key, { pages: [] });
    (initial ? m.unsave : m.save).mockResolvedValueOnce({ saved: !initial });
    await act(async () => { await h.mutation.mutateAsync('recipe-1'); });
    expect(h.client.getQueryState(key)?.isInvalidated).toBe(true);
    await h.close();
  }
});

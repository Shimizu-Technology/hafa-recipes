import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSaveRecipe, useUnsaveRecipe, recipeKeys } from './useRecipes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({ subject: 'viewer', save: vi.fn(), unsave: vi.fn(), reconcile: vi.fn(), toast: vi.fn(), success: vi.fn() }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: m.subject }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-native', () => ({ AppState: {} }));
vi.mock('../lib/api', () => ({ api: { saveRecipe: m.save, unsaveRecipe: m.unsave } }));
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
beforeEach(() => { vi.clearAllMocks(); m.subject='viewer'; m.reconcile.mockResolvedValue(undefined); });

describe('confirmed recipe saving', () => {
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
    expect(m.reconcile).toHaveBeenCalledWith(h.client, 'recipe-1');
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

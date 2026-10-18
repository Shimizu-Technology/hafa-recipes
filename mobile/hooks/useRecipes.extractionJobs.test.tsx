import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  startAsyncExtraction: vi.fn(),
  startReExtraction: vi.fn(),
  getExtractionJobs: vi.fn(),
  getCurrentUserIdentity: vi.fn(),
  getItem: vi.fn(),
  getJobStatus: vi.fn(),
  getUserId: vi.fn(),
  removeItem: vi.fn(),
  setItem: vi.fn(),
  deleteRecipe: vi.fn(),
  cancelJob: vi.fn(),
  alert: vi.fn(),
  focused: true,
  getAuthScope: vi.fn(),
  authScope: { userId: null as string | null, epoch: 0 },
}));

vi.mock('expo-router', () => ({ useIsFocused: () => mocks.focused }));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: Boolean(mocks.getUserId()), userId: mocks.getUserId() }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    removeItem: mocks.removeItem,
    setItem: mocks.setItem,
  },
}));
vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock('../lib/api', () => ({
  api: {
    startAsyncExtraction: mocks.startAsyncExtraction,
    startReExtraction: mocks.startReExtraction,
    getCurrentUserIdentity: mocks.getCurrentUserIdentity,
    getExtractionJobs: mocks.getExtractionJobs,
    getJobStatus: mocks.getJobStatus,
    deleteRecipe: mocks.deleteRecipe,
    cancelJob: mocks.cancelJob,
    getAuthScope: mocks.getAuthScope,
  },
}));

import { useRecipeDeletion } from './useRecipeDeletion';
import { recipeKeys, useAsyncExtractionController, useDeleteRecipe, useExtractionJobs } from './useRecipes';
import { importInbox, createImportInbox } from '../lib/importInbox';
import { ExtractionProvider, useAsyncExtraction } from '../contexts/ExtractionContext';
import { useImportInboxProcessor } from './useImportInbox';

type Controller = ReturnType<typeof useAsyncExtractionController>;

beforeEach(() => {
  mocks.authScope = { userId: null, epoch: 0 };
  mocks.getAuthScope.mockImplementation(() => {
    const userId = mocks.getUserId() ?? null;
    if (userId !== mocks.authScope.userId) mocks.authScope = { userId, epoch: mocks.authScope.epoch + 1 };
    return mocks.authScope;
  });
});

describe('durable extraction recovery', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => { if (typeof mock === 'function') mock.mockReset(); });
    mocks.getItem.mockResolvedValue(null);
    mocks.getUserId.mockReturnValue('clerk-current-user');
    mocks.getCurrentUserIdentity.mockResolvedValue({ id: 'app-stable-user' });
    mocks.removeItem.mockResolvedValue(undefined);
    mocks.setItem.mockResolvedValue(undefined);
    mocks.getExtractionJobs.mockResolvedValue([{
      id: 'server-job',
      url: 'https://www.tiktok.com/@cook/video/123',
      job_kind: 'extract',
      status: 'processing',
      progress: 40,
      current_step: 'extracting',
      message: 'Extracting recipe',
      recipe_id: null,
      error_message: null,
      created_at: '2026-09-07T00:00:00Z',
    }]);
    mocks.getJobStatus.mockReturnValue(new Promise(() => undefined));
  });

  it.each(['success', 'offline', '404', 'other-selected', 'owner-switch'] as const)(
    'retires only the acknowledged job after cancellation: %s', async (outcome) => {
      mocks.getExtractionJobs.mockResolvedValue([]);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let controller!: Controller;
      function Harness() { controller = useAsyncExtractionController(); return null; }
      const tree = () => <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>;
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(tree()); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      const failed = { id: 'attempt-a', url: 'https://example.com/same', status: 'failed' as const,
        progress: 30, current_step: 'error', message: 'Failed', recipe_id: null, error_message: 'Try again' };
      const second = { ...failed, id: 'attempt-b' };
      const key = ['extractionJobs', 'recent', 'app-stable-user', 'extract'];
      const foreignKey = ['extractionJobs', 'recent', 'app-other', 'extract'];
      queryClient.setQueryData(key, [failed, second]); queryClient.setQueryData(foreignKey, [failed]);
      await act(async () => controller.restoreJob(failed));
      let finish!: () => void;
      mocks.cancelJob.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      let cancellation!: Promise<void>;
      await act(async () => { cancellation = controller.cancel(); });
      expect(mocks.cancelJob).toHaveBeenCalledExactlyOnceWith('attempt-a');
      expect(controller.jobId).toBe('attempt-a');
      expect(queryClient.getQueryData(key)).toEqual([failed, second]);
      if (outcome === 'other-selected') await act(async () => controller.restoreJob(second));
      if (outcome === 'owner-switch') {
        mocks.getUserId.mockReturnValue('clerk-b'); mocks.getCurrentUserIdentity.mockResolvedValue({ id: 'app-other' });
        await act(async () => renderer.update(tree()));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      }
      await act(async () => { finish(); await cancellation; });
      if (outcome === 'owner-switch') {
        expect(queryClient.getQueryData(key)).toEqual([failed, second]);
      } else {
        expect(queryClient.getQueryData(key)).toEqual([second]);
        expect(controller.jobId).toBe(outcome === 'other-selected' ? 'attempt-b' : null);
      }
      expect(queryClient.getQueryData(foreignKey)).toEqual([failed]);
      if (outcome === 'offline' || outcome === '404') {
        await act(async () => controller.restoreJob(second));
        mocks.cancelJob.mockRejectedValueOnce(outcome === '404' ? { response: { status: 404 } } : new Error('Offline'));
        await act(async () => { await expect(controller.cancel()).rejects.toBeDefined(); });
        expect(controller.jobId).toBe('attempt-b');
        expect(queryClient.getQueryData(key)).toEqual([second]);
      }
      await act(async () => renderer.unmount()); queryClient.clear();
    },
  );

  it('retains an uncertain start receipt until Reconnect discovers the remote job', async () => {
    mocks.getExtractionJobs.mockResolvedValue([]);
    mocks.startAsyncExtraction.mockRejectedValueOnce(new Error('Offline'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let controller!: Controller;
    function Harness() { controller = useAsyncExtractionController(); return null; }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await act(async () => { await expect(controller.startExtraction({ url: 'https://example.com/a' }, 'share:receipt')).rejects.toThrow(); });
    expect(controller).toMatchObject({ jobId: null, canRetryStart: true, requestKey: 'share:receipt' });
    mocks.removeItem.mockClear();
    await act(async () => {
      await expect(controller.cancel()).rejects.toThrow('Reconnect');
      await expect(controller.reset()).rejects.toThrow('Reconnect');
      await expect(controller.startExtraction({ url: 'https://example.com/other' })).rejects.toThrow('Reconnect');
      controller.restoreJob({ id: 'other', url: 'https://example.com/other', status: 'failed', progress: 0,
        current_step: 'error', message: 'Failed', recipe_id: null, error_message: null });
    });
    expect(mocks.cancelJob).not.toHaveBeenCalled(); expect(mocks.removeItem).not.toHaveBeenCalled();
    expect(controller).toMatchObject({ canRetryStart: true, requestKey: 'share:receipt' });
    await act(async () => renderer.unmount()); queryClient.clear();
  });

  it.each(['claim gap', 'lost response', 'cleared terminal receipt', 'terminal polling', 'cancelled replay', 'processing replay'] as const)(
    'recovers an inbox claim across reload without a new key or automatic submission: %s', async (crash) => {
      const persisted = new Map<string, string>();
      mocks.getItem.mockImplementation(async (key: string) => persisted.get(key) ?? null);
      mocks.setItem.mockImplementation(async (key: string, value: string) => { persisted.set(key, value); });
      mocks.removeItem.mockImplementation(async (key: string) => { persisted.delete(key); });
      mocks.getExtractionJobs.mockResolvedValue([]);
      await importInbox.hydrate();
      for (const item of importInbox.snapshot()) await importInbox.remove(item.id);
      const request = { url: 'https://example.com/crash', notes: '2 cups rice', location: 'Hawaii', is_public: false };
      await importInbox.add({ id: 'crash', ownerId: 'app-stable-user', createdAt: Date.now(), state: 'ready',
        capture: { kind: 'url', url: request.url }, request });
      await importInbox.claimForSubmit('crash', 'app-stable-user', importInbox.snapshot()[0]);
      const receiptKey = 'active_extraction_job_v2:app-stable-user';
      if (crash === 'terminal polling') persisted.set(receiptKey, JSON.stringify({
        userId: 'app-stable-user', jobId: 'original-job', idempotencyKey: 'share:crash',
        startTime: Date.now(), request: { kind: 'extract', payload: request },
      }));
      if (crash === 'cleared terminal receipt') await importInbox.patch('crash', { state: 'error', error: 'Lost confirmation' });
      let remoteJobs = crash === 'claim gap' || crash === 'lost response' ? 0 : 1;
      let loseResponse = crash === 'lost response';
      const replayRejected = ['lost response', 'cleared terminal receipt', 'cancelled replay', 'processing replay'].includes(crash);
      const remoteStatus = crash === 'cancelled replay' ? 'cancelled' : crash === 'processing replay' ? 'processing' : 'failed';
      const originalJob = { id: 'original-job', url: request.url, status: remoteStatus,
        progress: 30, current_step: 'error', message: 'Original job', recipe_id: null, error_message: 'No recipe found' };
      mocks.getExtractionJobs.mockImplementation(async (options) => options.idempotencyKey ? [originalJob] : []);
      mocks.startAsyncExtraction.mockImplementation(async (_request, key, guard) => {
        guard();
        expect(key).toBe('share:crash');
        if (!remoteJobs) remoteJobs += 1;
        if (loseResponse) { loseResponse = false; throw new Error('Response lost after server acceptance'); }
        if (replayRejected) throw { response: { status: 409 } };
        return { job_id: 'original-job', status: 'failed', is_existing: true };
      });
      mocks.getJobStatus.mockResolvedValue(originalJob);
      let controller!: Controller;
      function Harness() { controller = useAsyncExtraction(); useImportInboxProcessor(); return null; }
      let queryClient!: QueryClient;
      let renderer!: ReactTestRenderer;
      const mount = async () => {
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        await act(async () => { renderer = create(<QueryClientProvider client={queryClient}>
          <ExtractionProvider><Harness /></ExtractionProvider></QueryClientProvider>); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      };
      const unmount = async () => { await act(async () => renderer.unmount()); queryClient.clear(); };
      await mount();
      expect(mocks.startAsyncExtraction).not.toHaveBeenCalled();
      if (crash !== 'terminal polling') {
        expect(controller).toMatchObject({ canRetryStart: true, requestKey: 'share:crash' });
        await act(async () => { await importInbox.removeWaiting('crash', 'app-stable-user'); });
        expect(importInbox.snapshot()[0].submissionClaimed).toBe(true);
        if (crash === 'lost response') {
          await act(async () => controller.retryPendingStart());
          expect(controller.canRetryStart).toBe(true);
          expect(remoteJobs).toBe(1);
        }
        await unmount();
        const reloaded = createImportInbox({ getItem: mocks.getItem, setItem: mocks.setItem });
        await reloaded.hydrate();
        expect(reloaded.snapshot()[0]).toMatchObject({ submissionClaimed: true, request });
        await mount();
        const callsBeforeReconnect = mocks.startAsyncExtraction.mock.calls.length;
        expect(callsBeforeReconnect).toBe(crash === 'lost response' ? 1 : 0);
        await act(async () => controller.retryPendingStart());
        expect(mocks.startAsyncExtraction).toHaveBeenLastCalledWith(request, 'share:crash', expect.any(Function));
      }
      expect(remoteJobs).toBe(1);
      expect(controller).toMatchObject({ jobId: 'original-job', isFailed: remoteStatus !== 'processing',
        canRetryStart: false, requestKey: 'share:crash' });
      expect(importInbox.snapshot()[0]).toMatchObject({ state: 'accepted', jobId: 'original-job' });
      if (replayRejected) {
        expect(mocks.getExtractionJobs).toHaveBeenCalledWith({ limit: 1, includeCancelled: true,
          jobKind: 'extract', idempotencyKey: 'share:crash' });
        expect(mocks.setItem).toHaveBeenCalledWith(receiptKey, expect.stringContaining('"jobId":"original-job"'));
        expect(controller.jobStatus?.status).toBe(remoteStatus);
        const recentKey = ['extractionJobs', 'recent', 'app-stable-user', 'extract'];
        const sibling = { ...originalJob, id: 'same-url-different-attempt' };
        queryClient.setQueryData(recentKey, [originalJob, sibling]);
        mocks.cancelJob.mockResolvedValueOnce({ job_id: 'original-job' });
        const callsBeforeRemoval = mocks.startAsyncExtraction.mock.calls.length;
        await act(async () => controller.cancel());
        expect(mocks.cancelJob).toHaveBeenCalledExactlyOnceWith('original-job');
        expect(queryClient.getQueryData(recentKey)).toEqual([sibling]);
        expect(controller.jobId).toBeNull();
        expect(mocks.startAsyncExtraction).toHaveBeenCalledTimes(callsBeforeRemoval);
      }
      expect(persisted.has(receiptKey)).toBe(false);
      await act(async () => controller.restoreJob({ id: 'other-attempt', url: request.url, status: 'failed',
        progress: 0, current_step: 'error', message: 'Failed', recipe_id: null, error_message: null }));
      expect(controller.requestKey).toBeNull();
      const callsAfterConfirmation = mocks.startAsyncExtraction.mock.calls.length;
      await unmount();
      await mount();
      expect(mocks.startAsyncExtraction).toHaveBeenCalledTimes(callsAfterConfirmation);
      expect(controller.canRetryStart).toBe(false);
      await unmount();
    },
  );

  it.each([400, 403, 404, 409, 422, 401, 'network', 'storage', 'lookup404', 'lookupNetwork'] as const)(
    'reconciles only definite recovered-start rejections and unblocks the next capture: %s', async (status) => {
      const persisted = new Map<string, string>();
      let rejectionStorageUnavailable = status === 'storage';
      mocks.getItem.mockImplementation(async (key: string) => persisted.get(key) ?? null);
      mocks.setItem.mockImplementation(async (key: string, value: string) => {
        if (key === 'hafa_import_inbox_v1' && rejectionStorageUnavailable && value.includes('"submissionClaimed":false')) {
          throw new Error('Disk full');
        }
        persisted.set(key, value);
      });
      mocks.removeItem.mockImplementation(async (key: string) => { persisted.delete(key); });
      mocks.getExtractionJobs.mockImplementation(async (options) => {
        if (options.idempotencyKey && status === 'lookup404') throw { response: { status: 404 } };
        if (options.idempotencyKey && status === 'lookupNetwork') throw new Error('Lookup offline');
        return [];
      });
      await importInbox.hydrate();
      for (const item of importInbox.snapshot()) await importInbox.remove(item.id);
      const request = { url: 'https://example.com/same', notes: '2 cups rice', location: 'Hawaii', is_public: true };
      await importInbox.add({ id: 'rejected', ownerId: 'app-stable-user', createdAt: Date.now(), state: 'submitting',
        submissionClaimed: true, capture: { kind: 'url', url: request.url }, request });
      await importInbox.add({ id: 'foreign', ownerId: 'other-owner', createdAt: Date.now(), state: 'error',
        submissionClaimed: true, capture: { kind: 'url', url: request.url }, request });
      await importInbox.add({ id: 'next', ownerId: 'app-stable-user', createdAt: Date.now(), state: 'ready',
        capture: { kind: 'url', url: request.url } });
      mocks.startAsyncExtraction.mockImplementation(async (_request, key, guard) => {
        guard();
        if (key === 'share:rejected') throw status === 'network' ? new Error('Offline')
          : { response: { status: status === 'storage' ? 403 : typeof status === 'string' ? 409 : status,
            data: { detail: 'Review public sharing to finish this import.' } } };
        expect(key).toBe('share:next');
        return { job_id: 'next-job', status: 'processing' };
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let controller!: Controller;
      function Harness() { controller = useAsyncExtraction(); useImportInboxProcessor(); return null; }
      let renderer!: ReactTestRenderer;
      try {
        await act(async () => { renderer = create(<QueryClientProvider client={queryClient}>
          <ExtractionProvider><Harness /></ExtractionProvider></QueryClientProvider>); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        expect(controller).toMatchObject({ canRetryStart: true, requestKey: 'share:rejected' });
        expect(mocks.startAsyncExtraction).not.toHaveBeenCalled();
        await act(async () => importInbox.removeWaiting('rejected', 'app-stable-user'));
        expect(importInbox.snapshot()[0].submissionClaimed).toBe(true);
        await act(async () => controller.retryPendingStart());
        expect(mocks.startAsyncExtraction).toHaveBeenNthCalledWith(1, request, 'share:rejected', expect.any(Function));
        const exactLookups = mocks.getExtractionJobs.mock.calls.filter(([options]) => options.idempotencyKey);
        expect(exactLookups).toEqual(status === 401 || status === 'network' ? [] : [[{
          limit: 1, includeCancelled: true, jobKind: 'extract', idempotencyKey: 'share:rejected',
        }]]);
        const reloaded = createImportInbox({ getItem: mocks.getItem, setItem: mocks.setItem });
        await reloaded.hydrate();
        expect(importInbox.snapshot()[1]).toMatchObject({ id: 'foreign', ownerId: 'other-owner', submissionClaimed: true });
        if (status === 401 || status === 'network' || status === 'storage' || status === 'lookup404' || status === 'lookupNetwork') {
          expect(controller).toMatchObject({ canRetryStart: true, requestKey: 'share:rejected', jobId: null });
          expect(reloaded.snapshot()[0]).toMatchObject({ submissionClaimed: true, request });
          await act(async () => importInbox.removeWaiting('rejected', 'app-stable-user'));
          await act(async () => controller.retryPendingStart());
          expect(mocks.startAsyncExtraction.mock.calls.map(([, key]) => key)).toEqual(['share:rejected', 'share:rejected']);
          expect(JSON.parse(persisted.get('active_extraction_job_v2:app-stable-user')!)).toMatchObject({
            jobId: null, idempotencyKey: 'share:rejected', request: { payload: request },
          });
          expect(importInbox.snapshot()).toMatchObject([{ id: 'rejected', submissionClaimed: true },
            { id: 'foreign' }, { id: 'next', state: 'ready' }]);
          if (status === 'storage') {
            rejectionStorageUnavailable = false;
            await act(async () => controller.retryPendingStart());
            expect(importInbox.snapshot()[0]).toMatchObject({ state: 'error', submissionClaimed: false, request });
            expect(importInbox.snapshot()[2]).toMatchObject({ state: 'accepted', jobId: 'next-job' });
            expect(mocks.startAsyncExtraction.mock.calls.map(([, key]) => key)).toEqual([
              'share:rejected', 'share:rejected', 'share:rejected', 'share:next',
            ]);
          }
        } else {
          expect(reloaded.snapshot()[0]).toMatchObject({ state: 'error', submissionClaimed: false, request,
            error: 'Review public sharing to finish this import.' });
          expect(importInbox.snapshot()[2]).toMatchObject({ id: 'next', state: 'accepted', jobId: 'next-job' });
          expect(mocks.startAsyncExtraction.mock.calls.map(([, key]) => key)).toEqual(['share:rejected', 'share:next']);
          await act(async () => importInbox.removeWaiting('rejected', 'app-stable-user'));
          expect(importInbox.snapshot().map(({ id }) => id)).toEqual(['foreign', 'next']);
        }
      } finally {
        if (renderer) await act(async () => renderer.unmount());
        queryClient.clear();
      }
    },
  );

  it.each(['empty', 'found', 'unavailable'] as const)(
    'retains the original claim when accounts switch during exact-key resolution: %s', async (lookup) => {
      const persisted = new Map<string, string>();
      mocks.getItem.mockImplementation(async (key: string) => persisted.get(key) ?? null);
      mocks.setItem.mockImplementation(async (key: string, value: string) => { persisted.set(key, value); });
      mocks.removeItem.mockImplementation(async (key: string) => { persisted.delete(key); });
      let finish!: () => void;
      mocks.getExtractionJobs.mockImplementation(async (options) => {
        if (!options.idempotencyKey) return [];
        expect(options).toEqual({ limit: 1, includeCancelled: true, jobKind: 'extract', idempotencyKey: 'share:owned' });
        return new Promise((resolve, reject) => { finish = () => lookup === 'unavailable'
          ? reject(new Error('Offline')) : resolve(lookup === 'empty' ? [] : [{ id: 'old-account-job' }]); });
      });
      mocks.startAsyncExtraction.mockRejectedValue({ response: { status: 409 } });
      await importInbox.hydrate();
      for (const item of importInbox.snapshot()) await importInbox.remove(item.id);
      const entry = { id: 'owned', ownerId: 'app-stable-user', createdAt: Date.now(), state: 'submitting' as const,
        submissionClaimed: true, capture: { kind: 'url' as const, url: 'https://example.com/owned' } };
      await importInbox.add(entry);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let controller!: Controller, renderer!: ReactTestRenderer;
      function Harness() { controller = useAsyncExtractionController(); return null; }
      const tree = () => <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>;
      try {
        await act(async () => { renderer = create(tree()); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        await act(async () => controller.recoverImport(entry));
        let reconnect!: Promise<void>;
        await act(async () => { reconnect = controller.retryPendingStart(); });
        expect(finish).toBeDefined();
        mocks.getUserId.mockReturnValue('clerk-b'); mocks.getCurrentUserIdentity.mockResolvedValue({ id: 'app-b' });
        await act(async () => renderer.update(tree()));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        mocks.removeItem.mockClear();
        await act(async () => { finish(); await reconnect; });
        const receiptKey = 'active_extraction_job_v2:app-stable-user';
        expect(JSON.parse(persisted.get(receiptKey)!)).toMatchObject({ jobId: null, idempotencyKey: 'share:owned' });
        expect(mocks.removeItem).not.toHaveBeenCalledWith(receiptKey);
        expect(importInbox.snapshot()[0]).toMatchObject({ state: 'submitting', submissionClaimed: true });
        expect(controller).toMatchObject({ jobId: null, requestKey: null, canRetryStart: false });
        expect(mocks.getJobStatus).not.toHaveBeenCalled();
        expect(mocks.startAsyncExtraction).toHaveBeenCalledOnce();
      } finally {
        if (renderer) await act(async () => renderer.unmount());
        queryClient.clear();
      }
    },
  );

  it('returns acceptance for a rejected reextract replay resolved by its exact key and kind', async () => {
    mocks.getExtractionJobs.mockImplementation(async (options) => options.idempotencyKey
      ? [{ id: 'reextract-job', recipe_id: 'original-recipe' }] : []);
    mocks.startReExtraction.mockRejectedValue({ response: { status: 403 } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let controller!: Controller, renderer!: ReactTestRenderer;
    function Harness() { controller = useAsyncExtractionController(); return null; }
    try {
      await act(async () => { renderer = create(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      await act(async () => {
        await expect(controller.startReExtraction('original-recipe')).resolves.toEqual({
          status: 'processing', jobId: 'reextract-job', recipeId: 'original-recipe', isExisting: true,
        });
      });
      const key = mocks.startReExtraction.mock.calls[0][2];
      expect(mocks.getExtractionJobs).toHaveBeenCalledWith({ limit: 1, includeCancelled: true,
        jobKind: 'reextract', idempotencyKey: key });
      expect(controller).toMatchObject({ jobId: 'reextract-job', requestKey: key, canRetryStart: false, isPolling: true });
      expect(mocks.startReExtraction).toHaveBeenCalledOnce();
      expect(mocks.getJobStatus).toHaveBeenCalledExactlyOnceWith('reextract-job');
    } finally {
      if (renderer) await act(async () => renderer.unmount());
      queryClient.clear();
    }
  });

  it('keeps a recovered receipt with its exact owner when accounts switch during its persistence', async () => {
    mocks.getExtractionJobs.mockResolvedValue([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let controller!: Controller;
    function Harness() { controller = useAsyncExtractionController(); return null; }
    const tree = () => <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(tree()); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const entry = { id: 'owned', ownerId: 'app-stable-user', createdAt: Date.now(), state: 'submitting' as const,
      submissionClaimed: true, capture: { kind: 'url' as const, url: 'https://example.com/owned' } };
    let release!: () => void;
    mocks.setItem.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    let recovery!: Promise<void>;
    await act(async () => { recovery = controller.recoverImport(entry); void recovery.catch(() => undefined); });
    mocks.getUserId.mockReturnValue('clerk-b'); mocks.getCurrentUserIdentity.mockResolvedValue({ id: 'app-b' });
    await act(async () => renderer.update(tree()));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await act(async () => release());
    await expect(recovery).rejects.toThrow('account changed');
    expect(controller).toMatchObject({ requestKey: null, canRetryStart: false, jobId: null });
    await expect(controller.recoverImport(entry)).rejects.toThrow('account changed');
    expect(mocks.setItem).toHaveBeenCalledExactlyOnceWith('active_extraction_job_v2:app-stable-user',
      expect.stringContaining('"idempotencyKey":"share:owned"'));
    expect(mocks.startAsyncExtraction).not.toHaveBeenCalled();
    await act(async () => renderer.unmount()); queryClient.clear();
  });

  it('keeps recent-job cache data scoped to the signed-in account', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const firstAccountJobs = [{
      id: 'first-account-job',
      url: 'https://example.com/first',
      status: 'completed' as const,
      progress: 100,
      current_step: 'complete',
      message: 'Done',
      recipe_id: 'first-recipe',
      error_message: null,
    }];
    const secondAccountJobs = [{
      ...firstAccountJobs[0],
      id: 'second-account-job',
      url: 'https://example.com/second',
      recipe_id: 'second-recipe',
    }];
    mocks.getExtractionJobs
      .mockResolvedValueOnce(firstAccountJobs)
      .mockResolvedValueOnce(secondAccountJobs);
    mocks.getCurrentUserIdentity
      .mockResolvedValueOnce({ id: 'app-stable-user' })
      .mockResolvedValueOnce({ id: 'app-second-user' });

    function RecentJobsHarness() {
      useExtractionJobs('extract');
      return null;
    }

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <RecentJobsHarness />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    await act(async () => renderer!.unmount());

    mocks.getUserId.mockReturnValue('clerk-second-user');
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <RecentJobsHarness />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(mocks.getExtractionJobs).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(['extractionJobs', 'recent', 'app-stable-user', 'extract']))
      .toEqual(firstAccountJobs);
    expect(queryClient.getQueryData(['extractionJobs', 'recent', 'app-second-user', 'extract']))
      .toEqual(secondAccountJobs);

    await act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('uses the same durable job key after the Clerk subject changes', async () => {
    const storedJob = {
      userId: 'app-stable-user',
      jobId: 'persisted-job',
      idempotencyKey: 'persisted-key',
      startTime: Date.now(),
      request: { kind: 'extract' as const, payload: { url: 'https://example.com/recipe' } },
    };
    mocks.getItem.mockImplementation(async (key: string) => (
      key === 'active_extraction_job_v2:app-stable-user'
        ? JSON.stringify(storedJob)
        : null
    ));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function Harness() {
      useAsyncExtractionController();
      return null;
    }

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      renderer!.unmount();
    });

    mocks.getUserId.mockReturnValue('clerk-replacement-subject');
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(mocks.getCurrentUserIdentity).toHaveBeenCalledTimes(2);
    expect(mocks.getItem).toHaveBeenCalledWith('active_extraction_job_v2:app-stable-user');
    expect(mocks.getItem).not.toHaveBeenCalledWith('active_extraction_job_v2:clerk-replacement-subject');

    await act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('preserves and resumes the Clerk-scoped pointer when durable migration storage fails', async () => {
    const clerkScopedKey = 'active_extraction_job_v2:clerk-current-user';
    const durableKey = 'active_extraction_job_v2:app-stable-user';
    const storedJob = {
      userId: 'clerk-current-user',
      jobId: 'pending-server-job',
      idempotencyKey: 'pending-server-key',
      startTime: Date.now(),
      request: { kind: 'extract' as const, payload: { url: 'https://example.com/recipe' } },
    };
    mocks.getItem.mockImplementation(async (key: string) => (
      key === clerkScopedKey ? JSON.stringify(storedJob) : null
    ));
    mocks.setItem.mockRejectedValueOnce(new Error('storage unavailable'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let controller: Controller | null = null;

    function Harness() {
      controller = useAsyncExtractionController();
      return null;
    }

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(mocks.setItem).toHaveBeenCalledWith(
      durableKey,
      expect.stringContaining('"userId":"app-stable-user"'),
    );
    expect(mocks.removeItem).not.toHaveBeenCalledWith(clerkScopedKey);
    expect(controller).toMatchObject({
      jobId: 'pending-server-job',
      isExtracting: true,
    });

    await act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('does not start a new request while stale-pointer hydration is pending', async () => {
    let resolveDurableRead: (value: string | null) => void = () => undefined;
    const durableRead = new Promise<string | null>((resolve) => {
      resolveDurableRead = resolve;
    });
    const staleClerkJob = {
      userId: 'clerk-current-user',
      jobId: null,
      idempotencyKey: 'stale-key',
      startTime: Date.now() - (8 * 24 * 60 * 60 * 1_000),
      request: { kind: 'extract' as const, payload: { url: 'https://example.com/stale' } },
    };
    mocks.getItem.mockImplementation(async (key: string) => {
      if (key === 'active_extraction_job_v2:app-stable-user') return durableRead;
      if (key === 'active_extraction_job_v2:clerk-current-user') {
        return JSON.stringify(staleClerkJob);
      }
      return null;
    });
    mocks.getExtractionJobs.mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let controller: Controller | null = null;

    function Harness() {
      controller = useAsyncExtractionController();
      return null;
    }

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 5 && mocks.getItem.mock.calls.length === 0; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    await expect(controller!.startExtraction({ url: 'https://example.com/new' }))
      .rejects.toThrow('prepare your recent imports');
    expect(mocks.setItem).not.toHaveBeenCalled();

    await act(async () => {
      resolveDurableRead(null);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(controller).toMatchObject({ isReady: true, isPreparing: false });

    await act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('clears a prior failure when restoring a completed job', async () => {
    mocks.getExtractionJobs.mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let controller: Controller | null = null;

    function Harness() {
      controller = useAsyncExtractionController();
      return null;
    }

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    await act(async () => {
      controller!.restoreJob({
        id: 'failed-job',
        url: 'https://example.com/failed',
        notes: '2 cups rice\nSimmer 20 minutes.',
        location: 'Hawaii',
        requested_is_public: true,
        status: 'failed',
        progress: 20,
        current_step: 'error',
        message: 'Failed',
        recipe_id: null,
        error_message: 'Could not read the source',
      });
    });
    expect(controller).toMatchObject({
      error: 'Could not read the source',
      isComplete: false,
      isFailed: true,
      sourceUrl: 'https://example.com/failed',
      sourceNotes: '2 cups rice\nSimmer 20 minutes.',
      sourceLocation: 'Hawaii',
      requestedIsPublic: true,
    });

    await act(async () => {
      controller!.restoreJob({
        id: 'completed-job',
        url: 'https://example.com/completed',
        status: 'completed',
        progress: 100,
        current_step: 'complete',
        message: 'Done',
        recipe_id: 'completed-recipe',
        error_message: null,
      });
    });
    expect(controller).toMatchObject({
      error: null,
      isComplete: true,
      isFailed: false,
      recipeId: 'completed-recipe',
    });

    await act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it.each(['initial', 'confirmed'] as const)('does not mutate B after A awaits its %s storage write', async (boundary) => {
    mocks.getExtractionJobs.mockResolvedValue([]);
    mocks.startAsyncExtraction.mockResolvedValue({ job_id: 'job-a', status: 'processing' });
    let finishWrite!: () => void;
    let writes = 0;
    const persisted = new Map<string, string>();
    mocks.setItem.mockImplementation(async (key: string, value: string) => {
      writes += 1;
      if (writes === (boundary === 'initial' ? 1 : 2)) {
        await new Promise<void>((resolve) => { finishWrite = resolve; });
      }
      persisted.set(key, value);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let controller!: Controller;
    function Harness() { controller = useAsyncExtractionController(); return null; }
    const tree = () => <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(tree()); });
    for (let attempt = 0; attempt < 5; attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    let start!: Promise<unknown>;
    await act(async () => {
      start = controller.startExtraction({ url: 'https://example.com/a' }, 'capture-a');
      void start.catch(() => undefined);
    });
    expect(finishWrite).toBeTypeOf('function');
    mocks.getUserId.mockReturnValue('clerk-b');
    mocks.getCurrentUserIdentity.mockResolvedValue({ id: 'app-b' });
    await act(async () => renderer.update(tree()));
    for (let attempt = 0; attempt < 5; attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(controller).toMatchObject({ isReady: true, jobId: null, requestKey: null, isStarting: false });
    await act(async () => finishWrite());
    await expect(start).rejects.toThrow('account changed');
    expect(controller).toMatchObject({ jobId: null, requestKey: null, isStarting: false, error: null });
    expect(mocks.getJobStatus).not.toHaveBeenCalled();
    expect(JSON.parse(persisted.get('active_extraction_job_v2:app-stable-user')!)).toMatchObject({ userId: 'app-stable-user', jobId: boundary === 'initial' ? null : 'job-a' });
    expect(persisted.has('active_extraction_job_v2:app-b')).toBe(false);
    expect(mocks.startAsyncExtraction).toHaveBeenCalledTimes(boundary === 'initial' ? 0 : 1);
    await act(async () => renderer.unmount()); queryClient.clear();
  });

  it.each(['initial storage', 'authentication token', 'confirmed storage'] as const)(
    'invalidates an unmounted A controller awaiting %s before B mounts',
    async (boundary) => {
      mocks.getExtractionJobs.mockResolvedValue([]);
      const persisted = new Map<string, string>();
      let releaseBoundary!: () => void;
      let writes = 0;
      let currentToken = 'token-a';
      const dispatchRequest = vi.fn();
      mocks.setItem.mockImplementation(async (key: string, value: string) => {
        writes += 1;
        if ((boundary === 'initial storage' && writes === 1) ||
            (boundary === 'confirmed storage' && writes === 2)) {
          await new Promise<void>((resolve) => { releaseBoundary = resolve; });
        }
        persisted.set(key, value);
      });
      mocks.startAsyncExtraction.mockImplementation(async (
        request: { url: string }, _key: string, requestGuard: () => void,
      ) => {
        if (boundary === 'authentication token') {
          await new Promise<void>((resolve) => { releaseBoundary = resolve; });
        }
        // The API checks the controller guard after obtaining its current token.
        const token = currentToken;
        requestGuard();
        dispatchRequest({ url: request.url, token });
        return { job_id: 'job-a', status: 'processing' };
      });
      const clientA = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const clientB = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let controller!: Controller;
      function Harness() { controller = useAsyncExtractionController(); return null; }
      const tree = (client: QueryClient) => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(tree(clientA)); });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
      let start!: Promise<unknown>;
      await act(async () => {
        start = controller.startExtraction({ url: 'https://example.com/a' }, 'capture-a');
        void start.catch(() => undefined);
      });
      expect(releaseBoundary).toBeTypeOf('function');
      await act(async () => renderer.unmount());
      currentToken = 'token-b';
      mocks.getUserId.mockReturnValue('clerk-b');
      mocks.getCurrentUserIdentity.mockResolvedValue({ id: 'app-b' });
      await act(async () => { renderer = create(tree(clientB)); });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
      expect(controller).toMatchObject({ isReady: true, jobId: null, requestKey: null });
      await act(async () => releaseBoundary());
      await expect(start).rejects.toThrow('account changed');
      expect(dispatchRequest).not.toHaveBeenCalledWith(expect.objectContaining({ token: 'token-b' }));
      expect(dispatchRequest).toHaveBeenCalledTimes(boundary === 'confirmed storage' ? 1 : 0);
      expect(mocks.getJobStatus).not.toHaveBeenCalled();
      expect(JSON.parse(persisted.get('active_extraction_job_v2:app-stable-user')!)).toMatchObject({
        userId: 'app-stable-user',
        idempotencyKey: 'capture-a',
        jobId: boundary === 'confirmed storage' ? 'job-a' : null,
      });
      expect(persisted.has('active_extraction_job_v2:app-b')).toBe(false);
      expect(controller).toMatchObject({ jobId: null, requestKey: null, isStarting: false, error: null });
      await act(async () => renderer.unmount());
      clientA.clear();
      clientB.clear();
    },
  );

  it('rediscovers and resumes an owner job when local storage has no pointer', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let controller: Controller | null = null;
    let renderer: ReactTestRenderer;

    function Harness() {
      controller = useAsyncExtractionController();
      return null;
    }

    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(mocks.getExtractionJobs).toHaveBeenCalledWith({ limit: 1, activeOnly: true });
    expect(controller).toMatchObject({
      jobId: 'server-job',
      isExtracting: true,
      progress: 40,
      sourceUrl: 'https://www.tiktok.com/@cook/video/123',
    });

    await act(async () => renderer!.unmount());
    queryClient.clear();
  });
});

describe('recipe deletion connected caches', () => {
  it('refreshes server-deleted relationships and leaves unrelated filtered totals alone', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cache = (id: string, total: number) => ({ pages: [{ items: [{ id }], total }], pageParams: [0] });
    const filtered = recipeKeys.discoverInfinite('youtube');
    client.setQueryData(filtered, cache('other', 7));
    const related = [['collections', 'list'], ['meal-plans', 'week', '2026-10-12'], ['savedRecipes', 'infinite'], ['savedRecipesCount']];
    for (const key of related) client.setQueryData(key, {});
    mocks.deleteRecipe.mockResolvedValue({ id: 'deleted', message: 'Deleted' });
    mocks.getUserId.mockReturnValue('owner-a');
    let mutation!: ReturnType<typeof useDeleteRecipe>;
    function Hook() { mutation = useDeleteRecipe(); return null; }
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<QueryClientProvider client={client}><Hook /></QueryClientProvider>); });
      await act(async () => { await mutation.mutateAsync('deleted'); });
      expect((client.getQueryData(filtered) as any).pages[0].total).toBe(7);
      for (const key of related) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });
  it('restores saved/list rows after a rejected deletion and refreshes linked views', async () => {
    const client = new QueryClient();
    const data = { pages: [{ items: [{ id: 'deleted' }], total: 1 }], pageParams: [0] };
    client.setQueryData(recipeKeys.infinite(), data);
    client.setQueryData(recipeKeys.savedInfinite(), data);
    mocks.deleteRecipe.mockRejectedValue(new Error('Forbidden'));
    mocks.getUserId.mockReturnValue('owner-a');
    let mutation!: ReturnType<typeof useDeleteRecipe>;
    function Hook() { mutation = useDeleteRecipe(); return null; }
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<QueryClientProvider client={client}><Hook /></QueryClientProvider>); });
      await act(async () => { await mutation.mutateAsync('deleted').catch(() => undefined); });
      expect(client.getQueryData(recipeKeys.infinite())).toEqual(data);
      expect(client.getQueryData(recipeKeys.savedInfinite())).toEqual(data);
      expect(client.getQueryState(recipeKeys.savedInfinite())?.isInvalidated).toBe(true);
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });
  it('freezes the delete transport account while its token is pending', async () => {
    const client = new QueryClient();
    let finish!: () => void;
    mocks.deleteRecipe.mockImplementation((_id, guard) => new Promise<void>(resolve => { finish = resolve; }).then(() => { guard(); return { id: 'deleted', message: 'Deleted' }; }));
    mocks.getUserId.mockReturnValue('owner-a');
    let mutation!: ReturnType<typeof useDeleteRecipe>;
    function Hook() { mutation = useDeleteRecipe(); return null; }
    const tree = () => <QueryClientProvider client={client}><Hook /></QueryClientProvider>;
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(tree()); });
      let pending!: Promise<unknown>;
      await act(async () => { pending = mutation.mutateAsync('deleted').catch(error => error); });
      mocks.getUserId.mockReturnValue('owner-b'); await act(async () => renderer.update(tree()));
      await act(async () => finish());
      expect(await pending).toMatchObject({ message: 'Account changed; reopen your library.' });
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });
  it('does not navigate a new account after an accepted old account deletion completes', async () => {
    const client = new QueryClient();
    let finish!: () => void;
    mocks.deleteRecipe.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ id: 'deleted', message: 'Deleted' }); }));
    mocks.getUserId.mockReturnValue('owner-a');
    let mutation!: ReturnType<typeof useDeleteRecipe>;
    function Hook() { mutation = useDeleteRecipe(); return null; }
    const tree = () => <QueryClientProvider client={client}><Hook /></QueryClientProvider>;
    const navigate = vi.fn(), settled = vi.fn();
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(tree()); });
      let pending!: Promise<unknown>;
      await act(async () => { pending = mutation.mutateAsync('deleted', { onSuccess: navigate, onSettled: settled }); });
      mocks.getUserId.mockReturnValue('owner-b'); await act(async () => renderer.update(tree()));
      await act(async () => { finish(); await pending; });
      expect(navigate).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });
  it('does not refill cleared caches when an old account deletion fails late', async () => {
    const client = new QueryClient();
    client.setQueryData(recipeKeys.infinite(), { pages: [{ items: [{ id: 'deleted' }], total: 1 }] });
    let fail!: (error: Error) => void;
    mocks.deleteRecipe.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    mocks.getUserId.mockReturnValue('owner-a');
    let mutation!: ReturnType<typeof useDeleteRecipe>;
    function Hook() { mutation = useDeleteRecipe(); return null; }
    const tree = () => <QueryClientProvider client={client}><Hook /></QueryClientProvider>;
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(tree()); });
      let pending!: Promise<unknown>;
      await act(async () => { pending = mutation.mutateAsync('deleted').catch(() => undefined); });
      client.clear(); mocks.getUserId.mockReturnValue('owner-b');
      const current = { pages: [{ items: [{ id: 'new-account' }], total: 1 }] };
      client.setQueryData(recipeKeys.infinite(), current);
      await act(async () => renderer.update(tree()));
      await act(async () => { fail(new Error('Offline')); await pending; });
      expect(client.getQueryData(recipeKeys.infinite())).toEqual(current);
      expect(client.getQueryData(recipeKeys.savedInfinite())).toBeUndefined();
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });
});


describe('recipe detail deletion navigation', () => {
  beforeEach(() => { mocks.alert.mockReset(); mocks.deleteRecipe.mockReset(); mocks.focused = true; });
  const confirm = () => mocks.alert.mock.calls.at(-1)![2].find((button: { text: string }) => button.text === 'Delete').onPress;

  it.each(['cancelQueries', 'token'] as const)('keeps the detail mounted during a held %s and leaves only after the accepted delete', async held => {
    const client = new QueryClient();
    mocks.getUserId.mockReturnValue('owner-a');
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    if (held === 'cancelQueries') vi.spyOn(client, 'cancelQueries').mockImplementationOnce(() => barrier);
    const sent = vi.fn();
    mocks.deleteRecipe.mockImplementation(async (_id, guard) => {
      if (held === 'token') await barrier;
      guard(); sent(); return { id: 'deleted' };
    });
    let request!: ReturnType<typeof useRecipeDeletion>, renderer!: ReactTestRenderer;
    const back = vi.fn(() => renderer.update(<QueryClientProvider client={client}>{null}</QueryClientProvider>));
    function Detail() { request = useRecipeDeletion('deleted', back); return null; }
    try {
      await act(async () => { renderer = create(<QueryClientProvider client={client}><Detail /></QueryClientProvider>); });
      await act(async () => { request(); confirm()(); });
      expect(back).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
      await act(async () => { release(); });
      expect(sent).toHaveBeenCalledOnce(); expect(back).toHaveBeenCalledOnce();
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });

  it.each(['cancelQueries', 'token'] as const)('finishes a confirmed same-account deletion after unmount during %s', async held => {
    const client = new QueryClient(); mocks.getUserId.mockReturnValue('owner-a');
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    if (held === 'cancelQueries') vi.spyOn(client, 'cancelQueries').mockImplementationOnce(() => barrier);
    const sent = vi.fn();
    mocks.deleteRecipe.mockImplementation(async (_id, guard) => {
      if (held === 'token') await barrier;
      guard(); sent(); return { id: 'deleted' };
    });
    const linked = ['collections', 'list']; client.setQueryData(linked, {});
    let request!: ReturnType<typeof useRecipeDeletion>, renderer!: ReactTestRenderer;
    const back = vi.fn();
    function Detail() { request = useRecipeDeletion('deleted', back); return null; }
    await act(async () => { renderer = create(<QueryClientProvider client={client}><Detail /></QueryClientProvider>); });
    await act(async () => { request(); confirm()(); });
    await act(async () => renderer.unmount());
    await act(async () => release());
    expect(sent).toHaveBeenCalledOnce(); expect(back).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(linked)?.isInvalidated).toBe(true);
    client.clear();
  });

  it.each(['owner-b', 'return-to-owner-a'] as const)('rejects an unmounted delete token after root auth changes to %s', async next => {
    const client = new QueryClient(); mocks.getUserId.mockReturnValue('owner-a');
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const sent = vi.fn();
    mocks.deleteRecipe.mockImplementation(async (_id, guard) => { await barrier; guard(); sent(); return { id: 'deleted' }; });
    let request!: ReturnType<typeof useRecipeDeletion>, renderer!: ReactTestRenderer;
    const back = vi.fn();
    function Detail() { request = useRecipeDeletion('deleted', back); return null; }
    await act(async () => { renderer = create(<QueryClientProvider client={client}><Detail /></QueryClientProvider>); });
    await act(async () => { request(); confirm()(); });
    await act(async () => renderer.unmount());
    // Root authentication changes independently; the deleted hook never rerenders.
    mocks.getUserId.mockReturnValue('owner-b'); mocks.getAuthScope();
    if (next === 'return-to-owner-a') { mocks.getUserId.mockReturnValue('owner-a'); mocks.getAuthScope(); }
    await act(async () => release());
    expect(sent).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledTimes(1); client.clear();
  });

  it('keeps the detail after failure and permits one explicit retry without duplicate requests', async () => {
    const client = new QueryClient(); mocks.getUserId.mockReturnValue('owner-a');
    mocks.deleteRecipe.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ id: 'deleted' });
    let request!: ReturnType<typeof useRecipeDeletion>, renderer!: ReactTestRenderer;
    const back = vi.fn();
    function Detail() { request = useRecipeDeletion('deleted', back); return null; }
    try {
      await act(async () => { renderer = create(<QueryClientProvider client={client}><Detail /></QueryClientProvider>); });
      await act(async () => { request(); const press = confirm(); press(); press(); });
      expect(back).not.toHaveBeenCalled(); expect(mocks.deleteRecipe).toHaveBeenCalledTimes(1);
      expect(mocks.alert).toHaveBeenLastCalledWith('Error', expect.stringContaining('Please try again'));
      await act(async () => { request(); confirm()(); });
      expect(mocks.deleteRecipe).toHaveBeenCalledTimes(2); expect(back).toHaveBeenCalledOnce();
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });

  it('blocks a hidden confirmation and a replacement focused activation while the previous delete is still pending', async () => {
    const client = new QueryClient(); mocks.getUserId.mockReturnValue('owner-a');
    let release!: () => void;
    mocks.deleteRecipe.mockImplementation(() => new Promise(resolve => { release = () => resolve({ id: 'deleted' }); }));
    let request!: ReturnType<typeof useRecipeDeletion>, renderer!: ReactTestRenderer;
    const back = vi.fn();
    function Detail() { request = useRecipeDeletion('deleted', back); return null; }
    const tree = () => <QueryClientProvider client={client}><Detail /></QueryClientProvider>;
    try {
      await act(async () => { renderer = create(tree()); });
      await act(async () => { request(); confirm()(); });
      mocks.focused = false; await act(async () => renderer.update(tree()));
      await act(async () => request());
      mocks.focused = true; await act(async () => renderer.update(tree()));
      await act(async () => request());
      expect(mocks.alert).toHaveBeenCalledTimes(1);
      expect(mocks.deleteRecipe).toHaveBeenCalledOnce();
      await act(async () => release());
      expect(back).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); client.clear(); }
  });

  it.each(['account', 'recipe', 'unmount', 'blur', 'blur-return'] as const)('ignores an accepted old deletion after %s changes', async change => {
    const client = new QueryClient(); mocks.getUserId.mockReturnValue('owner-a');
    let release!: () => void;
    mocks.deleteRecipe.mockImplementation(() => new Promise(resolve => { release = () => resolve({ id: 'deleted' }); }));
    let request!: ReturnType<typeof useRecipeDeletion>, renderer!: ReactTestRenderer, id = 'deleted';
    const back = vi.fn();
    function Detail() { request = useRecipeDeletion(id, back); return null; }
    const tree = () => <QueryClientProvider client={client}><Detail /></QueryClientProvider>;
    try {
      await act(async () => { renderer = create(tree()); });
      await act(async () => { request(); confirm()(); });
      if (change === 'account') mocks.getUserId.mockReturnValue('owner-b');
      if (change === 'recipe') id = 'another';
      if (change === 'blur' || change === 'blur-return') mocks.focused = false;
      await act(async () => { if (change === 'unmount') renderer.unmount(); else renderer.update(tree()); });
      if (change === 'blur-return') { mocks.focused = true; await act(async () => renderer.update(tree())); }
      await act(async () => release());
      expect(back).not.toHaveBeenCalled();
      expect(mocks.alert).toHaveBeenCalledTimes(1);
    } finally { if (change !== 'unmount') await act(async () => renderer.unmount()); client.clear(); }
  });

  it.each(['account', 'recipe', 'unmount', 'blur', 'blur-return'] as const)('rejects a retired confirmation after %s changes', async change => {
    const client = new QueryClient(); mocks.getUserId.mockReturnValue('owner-a');
    let request!: ReturnType<typeof useRecipeDeletion>, renderer!: ReactTestRenderer, id = 'deleted';
    const back = vi.fn();
    function Detail() { request = useRecipeDeletion(id, back); return null; }
    const tree = () => <QueryClientProvider client={client}><Detail /></QueryClientProvider>;
    try {
      await act(async () => { renderer = create(tree()); });
      await act(async () => { request(); });
      const press = confirm();
      if (change === 'account') mocks.getUserId.mockReturnValue('owner-b');
      if (change === 'recipe') id = 'another';
      if (change === 'blur' || change === 'blur-return') mocks.focused = false;
      await act(async () => { if (change === 'unmount') renderer.unmount(); else renderer.update(tree()); });
      if (change === 'blur-return') { mocks.focused = true; await act(async () => renderer.update(tree())); }
      await act(async () => press());
      expect(mocks.deleteRecipe).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
    } finally { if (change !== 'unmount') await act(async () => renderer.unmount()); client.clear(); }
  });
});


it.each(['same-auth', 'changed-auth', 'returned-auth'] as const)(
  'rolls back an unmounted failed deletion only under its frozen %s authority', async next => {
    const client = new QueryClient(); mocks.getUserId.mockReturnValue('owner-a');
    const key = recipeKeys.infinite(); const original = { pages: [{ items: [{ id: 'deleted' }, { id: 'kept' }], total: 2 }], pageParams: [0] };
    client.setQueryData(key, original);
    let reject!: (error: Error) => void;
    mocks.deleteRecipe.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    let mutation!: ReturnType<typeof useDeleteRecipe>;
    function Hook() { mutation = useDeleteRecipe(); return null; }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<QueryClientProvider client={client}><Hook /></QueryClientProvider>); });
    let pending!: Promise<unknown>;
    await act(async () => { pending = mutation.mutateAsync('deleted').catch(() => undefined); });
    expect(client.getQueryData(key)).toMatchObject({ pages: [{ items: [{ id: 'kept' }], total: 1 }] });
    await act(async () => renderer.unmount());
    const replacement = { pages: [{ items: [{ id: 'new-account' }], total: 1 }], pageParams: [0] };
    if (next !== 'same-auth') {
      mocks.getUserId.mockReturnValue('owner-b'); mocks.getAuthScope();
      if (next === 'returned-auth') { mocks.getUserId.mockReturnValue('owner-a'); mocks.getAuthScope(); }
      client.clear(); client.setQueryData(key, replacement);
    }
    await act(async () => { reject(new Error('Offline')); await pending; });
    expect(client.getQueryData(key)).toEqual(next === 'same-auth' ? original : replacement);
    client.clear();
  }
);

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getExtractionJobs: vi.fn(),
  getCurrentUserIdentity: vi.fn(),
  getItem: vi.fn(),
  getJobStatus: vi.fn(),
  getUserId: vi.fn(),
  removeItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: true, userId: mocks.getUserId() }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    removeItem: mocks.removeItem,
    setItem: mocks.setItem,
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock('../lib/api', () => ({
  api: {
    getCurrentUserIdentity: mocks.getCurrentUserIdentity,
    getExtractionJobs: mocks.getExtractionJobs,
    getJobStatus: mocks.getJobStatus,
  },
}));

import { useAsyncExtractionController, useExtractionJobs } from './useRecipes';

type Controller = ReturnType<typeof useAsyncExtractionController>;

describe('durable extraction recovery', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
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

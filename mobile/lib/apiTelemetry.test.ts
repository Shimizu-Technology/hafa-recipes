import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {
    delete: vi.fn(),
    get: vi.fn(async (_url: string, _config?: unknown) => ({ data: { items: [] } })),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  addBreadcrumb: vi.fn(),
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('axios', () => ({ default: { create: () => mocks.client } }));
vi.mock('./apiConfig', () => ({ API_BASE_URL: 'https://api.example.test' }));
vi.mock('./sentry', () => ({
  addBreadcrumb: mocks.addBreadcrumb,
  captureError: mocks.captureError,
  captureMessage: mocks.captureMessage,
}));

import { api, getSafeApiErrorCode } from './api';

vi.stubGlobal('__DEV__', false);

const responseErrorHandler = () =>
  mocks.client.interceptors.response.use.mock.calls[0][1] as (error: unknown) => Promise<never>;

const privateBody = { detail: { code: 'recipe_invalid', message: 'Grandma secret: 2 cups of love' } };

describe('API error telemetry', () => {
  beforeEach(() => {
    mocks.captureError.mockClear();
    mocks.captureMessage.mockClear();
  });

  it('extracts only short machine-readable error codes', () => {
    expect(getSafeApiErrorCode(privateBody)).toBe('recipe_invalid');
    expect(getSafeApiErrorCode({ code: 'rate_limited' })).toBe('rate_limited');
    expect(getSafeApiErrorCode({ detail: 'free text with user content' })).toBeUndefined();
    expect(getSafeApiErrorCode({ code: 'has spaces and user text' })).toBeUndefined();
    expect(getSafeApiErrorCode(undefined)).toBeUndefined();
  });

  it.each([
    [500, 'captureError'],
    [422, 'captureMessage'],
  ] as const)('reports %s errors without the response body', async (status, reporter) => {
    const error = { message: 'Request failed', config: { url: '/api/recipes/x', method: 'post' }, response: { status, data: privateBody } };
    await expect(responseErrorHandler()(error)).rejects.toBe(error);
    const call = mocks[reporter].mock.calls[0];
    const context = call[call.length - 1] as { extra: Record<string, unknown> };
    expect(context.extra).toEqual({ status, errorCode: 'recipe_invalid' });
    expect(JSON.stringify(context)).not.toContain('Grandma secret');
  });
});

describe('search requests', () => {
  it('sends the requested library ownership scope without changing legacy callers', async () => {
    await api.searchRecipes('adobo', 20, 20, 'website', 'quick', ['dinner'], undefined, 'saved');
    expect(mocks.client.get).toHaveBeenLastCalledWith('/api/recipes/search', expect.objectContaining({
      params: expect.objectContaining({ ownership: 'saved', offset: 20, source_type: 'website', tags: 'dinner' }),
    }));
    await api.searchRecipes('adobo');
    expect(mocks.client.get).toHaveBeenLastCalledWith('/api/recipes/search', expect.objectContaining({
      params: expect.objectContaining({ ownership: undefined }),
    }));
  });
  it('pass the React Query abort signal to the transport', async () => {
    const controller = new AbortController();
    await api.searchPublicRecipes('adobo', 20, 0, undefined, undefined, undefined, undefined, undefined, controller.signal);
    expect(mocks.client.get).toHaveBeenLastCalledWith('/api/recipes/discover/search', expect.objectContaining({ signal: controller.signal }));
    await api.searchRecipes('adobo', 20, 0, undefined, undefined, undefined, controller.signal);
    expect(mocks.client.get).toHaveBeenLastCalledWith('/api/recipes/search', expect.objectContaining({ signal: controller.signal }));
  });
});

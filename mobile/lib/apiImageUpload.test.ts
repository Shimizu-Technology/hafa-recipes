import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const post = vi.fn(async (
    _endpoint: string,
    _body: unknown,
    _config?: unknown,
  ): Promise<{ data: Record<string, unknown> }> => ({ data: { success: true } }));
  return {
    client: {
      delete: vi.fn(),
      get: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      patch: vi.fn(),
      post,
      put: vi.fn(),
    },
    post,
  };
});

vi.mock('axios', () => ({
  default: { create: () => mocks.client },
}));
vi.mock('./apiConfig', () => ({ API_BASE_URL: 'https://api.example.test' }));
vi.mock('./sentry', () => ({
  addBreadcrumb: vi.fn(),
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

class InspectableFormData {
  readonly fields: Array<{ name: string; value: unknown }> = [];

  append(name: string, value: unknown) {
    this.fields.push({ name, value });
  }
}

import {
  api,
  AUTH_TOKEN_MAX_ATTEMPTS,
  AUTH_TOKEN_RETRY_DELAY_MS,
} from './api';

function uploadedFiles(formData: unknown, fieldName: string) {
  return (formData as InspectableFormData).fields
    .filter((field) => field.name === fieldName)
    .map((field) => field.value);
}

describe('recipe image multipart requests', () => {
  beforeEach(() => {
    mocks.post.mockClear();
    vi.stubGlobal('FormData', InspectableFormData);
  });

  it('preserves explicit shared-image metadata in the single-image OCR request', async () => {
    await api.extractRecipeFromImage({
      uri: 'file:///private/shared-image',
      fileName: 'shared-recipe.webp',
      mimeType: 'image/webp',
    }, 'Guam');

    expect(mocks.post).toHaveBeenCalledOnce();
    const [endpoint, formData, config] = mocks.post.mock.calls[0];
    expect(endpoint).toBe('/api/extract/ocr');
    expect(uploadedFiles(formData, 'image')).toEqual([{
      uri: 'file:///private/shared-image',
      name: 'shared-recipe.webp',
      type: 'image/webp',
    }]);
    expect((formData as InspectableFormData).fields).toContainEqual({ name: 'location', value: 'Guam' });
    expect(config).toMatchObject({
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90_000,
    });
  });

  it('infers supported descriptors from URI-only single-image OCR requests', async () => {
    const cases = [
      ['file:///recipes/front.png', 'image/png'],
      ['file:///recipes/steps.GIF', 'image/gif'],
      ['file:///recipes/card.webp?cache=1', 'image/webp'],
      ['file:///recipes/photo.jpg', 'image/jpeg'],
    ] as const;

    for (const [uri, type] of cases) {
      await api.extractRecipeFromImage(uri);
    }

    expect(mocks.post).toHaveBeenCalledTimes(cases.length);
    expect(mocks.post.mock.calls.map(([, formData]) => uploadedFiles(formData, 'image')[0]))
      .toEqual([
        { uri: 'file:///recipes/front.png', name: 'front.png', type: 'image/png' },
        { uri: 'file:///recipes/steps.GIF', name: 'steps.GIF', type: 'image/gif' },
        { uri: 'file:///recipes/card.webp?cache=1', name: 'card.webp', type: 'image/webp' },
        { uri: 'file:///recipes/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' },
      ]);
  });

  it('infers PNG, GIF, WebP, and JPEG descriptors in the multi-image OCR request', async () => {
    await api.extractRecipeFromMultipleImages([
      'file:///recipes/front.PNG?cache=1',
      'file:///recipes/steps.gif',
      'file:///recipes/card.webp',
      'file:///recipes/photo.jpeg',
    ], 'Saipan');

    expect(mocks.post).toHaveBeenCalledOnce();
    const [endpoint, formData, config] = mocks.post.mock.calls[0];
    expect(endpoint).toBe('/api/extract/ocr/multi');
    expect(uploadedFiles(formData, 'images')).toEqual([
      { uri: 'file:///recipes/front.PNG?cache=1', name: 'front.PNG', type: 'image/png' },
      { uri: 'file:///recipes/steps.gif', name: 'steps.gif', type: 'image/gif' },
      { uri: 'file:///recipes/card.webp', name: 'card.webp', type: 'image/webp' },
      { uri: 'file:///recipes/photo.jpeg', name: 'photo.jpeg', type: 'image/jpeg' },
    ]);
    expect((formData as InspectableFormData).fields).toContainEqual({ name: 'location', value: 'Saipan' });
    expect(config).toMatchObject({
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180_000,
    });
  });

  it('preserves explicit metadata and infers from a provided filename in multi-image OCR', async () => {
    await api.extractRecipeFromMultipleImages([
      {
        uri: 'file:///private/no-extension',
        fileName: 'shared-card.png',
        mimeType: 'image/png',
      },
      {
        uri: 'file:///private/opaque-image',
        fileName: 'shared-steps.webp',
      },
    ]);

    const [, formData] = mocks.post.mock.calls[0];
    expect(uploadedFiles(formData, 'images')).toEqual([
      { uri: 'file:///private/no-extension', name: 'shared-card.png', type: 'image/png' },
      { uri: 'file:///private/opaque-image', name: 'shared-steps.webp', type: 'image/webp' },
    ]);
  });

  it('deletes large chat-image cleanup queues in bounded batches', async () => {
    mocks.post
      .mockResolvedValueOnce({ data: { deleted: 50 } })
      .mockResolvedValueOnce({ data: { deleted: 50 } })
      .mockResolvedValueOnce({ data: { deleted: 20 } });
    const imageUrls = Array.from(
      { length: 120 },
      (_, index) => `https://images.example/chat-${index}.jpg`,
    );

    const result = await api.deleteChatImages(imageUrls);

    expect(result).toEqual({ deleted: 120 });
    expect(mocks.post).toHaveBeenCalledTimes(3);
    expect(mocks.post.mock.calls.map(([, body]) => (
      body as { image_urls: string[] }
    ).image_urls.length)).toEqual([50, 50, 20]);
    expect(mocks.post.mock.calls.every(
      ([endpoint]) => endpoint === '/api/recipes/ai/delete-chat-images',
    )).toBe(true);
  });

  it('bounds token retries when Clerk returns no token', async () => {
    vi.useFakeTimers();
    const getToken = vi.fn(async () => null);
    api.setTokenGetter(getToken);
    const requestInterceptor = mocks.client.interceptors.request.use.mock.calls[0][0];

    try {
      const request = requestInterceptor({ url: '/api/chat/cooking', headers: {} });
      await vi.advanceTimersByTimeAsync(
        AUTH_TOKEN_RETRY_DELAY_MS * (AUTH_TOKEN_MAX_ATTEMPTS - 1),
      );
      await expect(request).resolves.toMatchObject({ headers: {} });
      expect(getToken).toHaveBeenCalledTimes(AUTH_TOKEN_MAX_ATTEMPTS);
    } finally {
      api.setTokenGetter(null);
      vi.useRealTimers();
    }
  });

  it('cancels promptly while Clerk token retrieval is still pending', async () => {
    const getToken = vi.fn(() => new Promise<string | null>(() => undefined));
    const controller = new AbortController();
    api.setTokenGetter(getToken);

    try {
      const request = api.streamChatCookingAssistant(
        'Stop before the request starts',
        [],
        undefined,
        undefined,
        controller.signal,
      );
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      expect(getToken).toHaveBeenCalledOnce();
    } finally {
      api.setTokenGetter(null);
    }
  });
});

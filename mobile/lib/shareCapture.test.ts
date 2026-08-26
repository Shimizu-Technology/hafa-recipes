import type { ShareIntent, ShareIntentFile } from 'expo-share-intent';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingShareCapture,
  resolveShareIntent,
  stagePendingShareCapture,
} from './shareCapture';

function shareIntent(overrides: Partial<ShareIntent>): ShareIntent {
  return { files: null, type: null, webUrl: null, text: null, ...overrides };
}

function imageFile(overrides: Partial<ShareIntentFile> = {}): ShareIntentFile {
  return {
    fileName: 'recipe.png',
    mimeType: 'image/png',
    path: 'file:///tmp/recipe.png',
    size: 1024,
    width: 1170,
    height: 2532,
    duration: null,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('native recipe share routing', () => {
  it('preserves the existing URL-share path, including URLs embedded in text', () => {
    expect(resolveShareIntent(shareIntent({ webUrl: 'https://example.com/recipe' }), false))
      .toEqual({ kind: 'url', url: 'https://example.com/recipe' });
    expect(resolveShareIntent(shareIntent({ text: 'Try https://example.com/rice tonight' }), true))
      .toEqual({ kind: 'url', url: 'https://example.com/rice' });
  });

  it('routes plain recipe text for signed-in users and gives guests a clear boundary', () => {
    const intent = shareIntent({ text: '  Red Rice\r\n2 cups rice\r\nCook it.  ' });

    expect(resolveShareIntent(intent, true)).toEqual({
      kind: 'text',
      text: 'Red Rice\n2 cups rice\nCook it.',
    });
    expect(resolveShareIntent(intent, false)).toEqual({ kind: 'sign-in-required' });
  });

  it('routes supported multi-image shares and normalizes image/jpg', () => {
    const action = resolveShareIntent(shareIntent({
      files: [imageFile(), imageFile({ path: 'file:///tmp/back.jpg', mimeType: 'image/jpg' })],
      type: 'media',
    }), true);

    expect(action).toEqual({
      kind: 'images',
      images: [
        { uri: 'file:///tmp/recipe.png', mimeType: 'image/png' },
        { uri: 'file:///tmp/back.jpg', mimeType: 'image/jpeg' },
      ],
    });
  });

  it('rejects unsupported, oversized, and excessive image shares before upload', () => {
    expect(resolveShareIntent(shareIntent({
      files: [imageFile({ mimeType: 'image/heic' })],
    }), true)).toMatchObject({ kind: 'unsupported' });
    expect(resolveShareIntent(shareIntent({
      files: [imageFile({ size: 10 * 1024 * 1024 + 1 })],
    }), true)).toEqual({
      kind: 'unsupported',
      message: 'Each recipe image must be 10 MB or smaller.',
    });
    expect(resolveShareIntent(shareIntent({
      files: Array.from({ length: 11 }, (_, index) => imageFile({ path: `file:///tmp/${index}.png` })),
    }), true)).toEqual({
      kind: 'unsupported',
      message: 'Share up to 10 recipe images at a time.',
    });
  });
});

describe('transient shared recipe content', () => {
  it('requires the matching token and consumes sensitive content only once', () => {
    const token = stagePendingShareCapture({ kind: 'text', text: 'private recipe text' });

    expect(consumePendingShareCapture('wrong-token')).toBeNull();
    expect(consumePendingShareCapture(token)).toEqual({
      kind: 'text',
      text: 'private recipe text',
    });
    expect(consumePendingShareCapture(token)).toBeNull();
  });

  it('discards staged content after five minutes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const token = stagePendingShareCapture({ kind: 'text', text: 'expired recipe text' });
    vi.mocked(Date.now).mockReturnValue(5 * 60 * 1000 + 1_001);

    expect(consumePendingShareCapture(token)).toBeNull();
  });
});

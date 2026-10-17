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

  it.each([
    { webUrl: 'https://www.instagram.com/reel/local-fixture/' },
    { meta: { url: 'https://www.tiktok.com/@fixture/video/123' } },
    {},
  ])('keeps a recipe caption with a direct, metadata, or embedded URL (%j)', (source) => {
    const url = source.webUrl || source.meta?.url || 'https://youtu.be/local-fixture';
    expect(resolveShareIntent(shareIntent({
      ...source,
      text: `  Red Rice\r\n2 cups rice\r\n\r\nSimmer for 20 minutes.\r\n${url}  `,
    }), true)).toEqual({
      kind: 'url', url, notes: 'Red Rice\n2 cups rice\n\nSimmer for 20 minutes.',
    });
  });

  it.each([
    'https://example.com/rice',
    'Check out this video on TikTok: https://example.com/rice',
    'Watch this reel on Instagram!\nhttps://example.com/rice',
    'Shared via YouTube\nhttps://example.com/rice',
    'Someone shared a video with you.\nhttps://example.com/rice',
    'Check this out: https://example.com/rice',
    '#recipe #food @cook\nhttps://example.com/rice',
  ])('does not promote URL-only or generic sharing copy to notes (%s)', (text) => {
    expect(resolveShareIntent(shareIntent({ text }), true))
      .toEqual({ kind: 'url', url: 'https://example.com/rice' });
  });

  it('removes boilerplate lines while retaining source wording, quantities, and non-English captions', () => {
    expect(resolveShareIntent(shareIntent({
      webUrl: 'https://example.com/rice',
      text: 'Watch this video\nArroz rojo\n½ taza de arroz\nCocinar 20 minutos.\nShared via TikTok',
    }), true)).toEqual({
      kind: 'url', url: 'https://example.com/rice',
      notes: 'Arroz rojo\n½ taza de arroz\nCocinar 20 minutos.',
    });
  });

  it('bounds captions to the existing API notes limit without splitting Unicode characters', () => {
    const caption = `Rice ${'🥥'.repeat(4_000)}`;
    const action = resolveShareIntent(shareIntent({ webUrl: 'https://example.com/rice', text: caption }), true);
    expect(action).toEqual({ kind: 'url', url: 'https://example.com/rice', notes: Array.from(caption).slice(0, 4_000).join('') });
  });

  it('keeps URL caption intake available to signed-out users without routing it as authenticated text', () => {
    expect(resolveShareIntent(shareIntent({
      text: '2 cups rice\nCook for 20 minutes.\nhttps://example.com/rice',
    }), false)).toEqual({
      kind: 'url', url: 'https://example.com/rice', notes: '2 cups rice\nCook for 20 minutes.',
    });
  });

  it('preserves standalone source quantities with their following ingredient lines', () => {
    expect(resolveShareIntent(shareIntent({
      webUrl: 'https://example.com/rice', text: 'Rice\n1/2\ncup stock\nCook 20 minutes.',
    }), true)).toEqual({
      kind: 'url', url: 'https://example.com/rice', notes: 'Rice\n1/2\ncup stock\nCook 20 minutes.',
    });
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

  it.each([null, Number.NaN, -1])(
    'fails closed when a shared image size cannot be verified (%s)',
    (size) => {
      expect(resolveShareIntent(shareIntent({
        files: [imageFile({ size })],
      }), true)).toEqual({
        kind: 'unsupported',
        message: 'Could not verify the size of every recipe image. Save the images, then import them from Håfa Recipes.',
      });
    },
  );

  it('rejects a known combined image size over 40 MB', () => {
    expect(resolveShareIntent(shareIntent({
      files: Array.from({ length: 5 }, (_, index) => imageFile({
        path: `file:///tmp/${index}.png`,
        size: 9 * 1024 * 1024,
      })),
    }), true)).toEqual({
      kind: 'unsupported',
      message: 'The combined recipe images must be 40 MB or smaller.',
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

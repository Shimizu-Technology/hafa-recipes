import { describe, expect, it } from 'vitest';

import {
  getSourcePlayback,
  isSourcePlaybackNavigationAllowed,
  YOUTUBE_APP_REFERRER,
} from './sourcePlayback';

describe('getSourcePlayback', () => {
  it('builds identified YouTube embeds for watch, short, and shorts links', () => {
    for (const sourceUrl of [
      'https://www.youtube.com/watch?v=abcDEF_1234&utm_source=share',
      'https://youtu.be/abcDEF_1234?si=tracking',
      'https://m.youtube.com/shorts/abcDEF_1234',
    ]) {
      expect(getSourcePlayback(sourceUrl)).toMatchObject({
        provider: 'youtube',
        providerLabel: 'YouTube',
        embedUrl: expect.stringContaining('/embed/abcDEF_1234?'),
        requestHeaders: { Referer: YOUTUBE_APP_REFERRER },
      });
    }
  });

  it('uses TikTok’s official player for video and photo posts', () => {
    expect(getSourcePlayback(
      'https://www.tiktok.com/@cook/video/7412345678901234567?_r=1',
    )).toMatchObject({
      provider: 'tiktok',
      embedUrl: expect.stringContaining('/player/v1/7412345678901234567'),
      aspectRatio: 9 / 16,
    });
    expect(getSourcePlayback(
      'https://m.tiktok.com/@cook/photo/7412345678901234568',
    )?.provider).toBe('tiktok');
  });

  it('builds Instagram public post and reel embed URLs', () => {
    expect(getSourcePlayback('https://www.instagram.com/reel/Example_42/?igsh=tracking')).toMatchObject({
      provider: 'instagram',
      embedUrl: 'https://www.instagram.com/reel/Example_42/embed/',
      aspectRatio: 4 / 5,
    });
    expect(getSourcePlayback('https://instagram.com/p/Post_123/')).toMatchObject({
      provider: 'instagram',
      embedUrl: 'https://www.instagram.com/p/Post_123/embed/',
    });
  });

  it('rejects unsupported pages, malformed IDs, and lookalike hosts', () => {
    for (const sourceUrl of [
      'manual://recipe',
      'https://example.com/recipe',
      'https://youtube.com.evil.example/watch?v=abcDEF_1234',
      'https://www.youtube.com/watch?v=<script>',
      'https://tiktok.com.evil.example/@cook/video/7412345678901234567',
      'https://instagram.com.evil.example/reel/Example_42/',
      'https://www.instagram.com/explore/',
    ]) {
      expect(getSourcePlayback(sourceUrl)).toBeNull();
    }
  });
});

describe('isSourcePlaybackNavigationAllowed', () => {
  it('allows blank startup and secure destinations owned by the selected provider', () => {
    expect(isSourcePlaybackNavigationAllowed('instagram', 'about:blank')).toBe(true);
    expect(isSourcePlaybackNavigationAllowed(
      'instagram',
      'https://www.instagram.com/reel/Example_42/',
    )).toBe(true);
    expect(isSourcePlaybackNavigationAllowed(
      'youtube',
      'https://consent.youtube.com/m?continue=example',
    )).toBe(true);
  });

  it('blocks external, insecure, app-scheme, lookalike, and malformed destinations', () => {
    for (const destinationUrl of [
      'https://apps.apple.com/app/instagram/id389801252',
      'http://www.instagram.com/reel/Example_42/',
      'instagram://reel/Example_42',
      'https://instagram.com.evil.example/reel/Example_42/',
      'javascript:alert(1)',
      'not a URL',
    ]) {
      expect(isSourcePlaybackNavigationAllowed('instagram', destinationUrl)).toBe(false);
    }
  });
});

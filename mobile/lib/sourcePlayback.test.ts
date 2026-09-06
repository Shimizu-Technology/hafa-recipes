import { describe, expect, it } from 'vitest';

import {
  getAutoplayEmbedUrl,
  getSourcePlayback,
  isSourcePlaybackNavigationAllowed,
  YOUTUBE_APP_REFERRER,
} from './sourcePlayback';

describe('getAutoplayEmbedUrl', () => {
  it('turns autoplay on for videos after explicit user intent', () => {
    const youtube = getSourcePlayback('https://youtu.be/abcDEF_1234');
    const tiktok = getSourcePlayback('https://www.tiktok.com/@cook/video/7412345678901234567');

    expect(youtube?.mode === 'modal' && getAutoplayEmbedUrl(youtube)).toContain('autoplay=1');
    expect(tiktok?.mode === 'modal' && getAutoplayEmbedUrl(tiktok)).toContain('autoplay=1');
    expect(tiktok?.mode === 'modal' && getAutoplayEmbedUrl(tiktok)).not.toContain('autoplay=0');
  });

  it('does not autoplay a TikTok photo post', () => {
    const photo = getSourcePlayback('https://www.tiktok.com/@cook/photo/7412345678901234568');

    expect(photo?.mode === 'modal' && getAutoplayEmbedUrl(photo)).toContain('autoplay=0');
  });
});

describe('getSourcePlayback', () => {
  it('builds identified YouTube embeds for watch, short, and shorts links', () => {
    for (const sourceUrl of [
      'https://www.youtube.com/watch?v=abcDEF_1234&utm_source=share',
      'https://youtu.be/abcDEF_1234?si=tracking',
      'https://m.youtube.com/shorts/abcDEF_1234',
    ]) {
      const playback = getSourcePlayback(sourceUrl);
      expect(playback).toMatchObject({
        provider: 'youtube',
        providerLabel: 'YouTube',
        mode: 'modal',
        mediaKind: 'video',
        embedUrl: expect.stringContaining('/embed/abcDEF_1234?'),
        requestHeaders: { Referer: YOUTUBE_APP_REFERRER },
      });
      expect(playback?.mode === 'modal' && playback.embedUrl).toContain(
        'https://www.youtube-nocookie.com/embed/',
      );
    }
  });

  it('uses TikTok’s official player for video and photo posts', () => {
    expect(getSourcePlayback(
      'https://www.tiktok.com/@cook/video/7412345678901234567?_r=1',
    )).toMatchObject({
      provider: 'tiktok',
      mode: 'modal',
      mediaKind: 'video',
      embedUrl: expect.stringContaining('/player/v1/7412345678901234567'),
      aspectRatio: 9 / 16,
    });
    expect(getSourcePlayback(
      'https://m.tiktok.com/@cook/photo/7412345678901234568',
    )).toMatchObject({ provider: 'tiktok', mode: 'modal', mediaKind: 'photo' });
  });

  it('recognizes Instagram sources without embedding their post document', () => {
    const reel = getSourcePlayback('https://www.instagram.com/reel/Example_42/?igsh=tracking');
    expect(reel).toMatchObject({
      provider: 'instagram',
      mode: 'external',
      mediaKind: 'reel',
    });
    expect(reel && 'embedUrl' in reel).toBe(false);
    expect(getSourcePlayback('https://instagram.com/p/Post_123/')).toMatchObject({
      provider: 'instagram',
      mode: 'external',
      mediaKind: 'post',
    });
    expect(getSourcePlayback('https://instagram.com/reels/Reel_123/')).toMatchObject({
      provider: 'instagram',
      mode: 'external',
      mediaKind: 'reel',
    });
    expect(getSourcePlayback('https://instagram.com/tv/Video_123/')).toMatchObject({
      provider: 'instagram',
      mode: 'external',
      mediaKind: 'video',
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
  const youtube = getSourcePlayback('https://youtu.be/abcDEF_1234');
  const tiktok = getSourcePlayback('https://www.tiktok.com/@cook/video/7412345678901234567');
  if (youtube?.mode !== 'modal' || tiktok?.mode !== 'modal') {
    throw new Error('Expected modal playback fixtures');
  }

  it('allows blank startup, the exact player path, and a scoped YouTube consent redirect', () => {
    expect(isSourcePlaybackNavigationAllowed(youtube, 'about:blank')).toBe(true);
    expect(isSourcePlaybackNavigationAllowed(
      tiktok,
      `${tiktok.embedUrl}&lang=en`,
    )).toBe(true);
    expect(isSourcePlaybackNavigationAllowed(
      youtube,
      `https://consent.youtube.com/m?continue=${encodeURIComponent(youtube.embedUrl)}`,
    )).toBe(true);
  });

  it('blocks provider browsing, unscoped consent, external, insecure, and malformed destinations', () => {
    expect(isSourcePlaybackNavigationAllowed(
      youtube,
      'https://www.youtube.com/watch?v=abcDEF_1234',
    )).toBe(false);
    expect(isSourcePlaybackNavigationAllowed(
      youtube,
      'https://www.youtube.com/embed/abcDEF_1234',
    )).toBe(false);
    expect(isSourcePlaybackNavigationAllowed(
      youtube,
      'https://consent.youtube.com/m?continue=https%3A%2F%2Fexample.com',
    )).toBe(false);

    for (const destinationUrl of [
      'https://www.tiktok.com/@cook/video/7412345678901234567',
      'https://apps.apple.com/app/tiktok/id835599320',
      'http://www.tiktok.com/@cook/video/7412345678901234567',
      'instagram://reel/Example_42',
      'https://tiktok.com.evil.example/@cook/video/7412345678901234567',
      'javascript:alert(1)',
      'not a URL',
    ]) {
      expect(isSourcePlaybackNavigationAllowed(tiktok, destinationUrl)).toBe(false);
    }
  });
});

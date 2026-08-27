import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { SourcePlayback } from '@/lib/sourcePlayback';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { navigationAllowed } = vi.hoisted(() => ({
  navigationAllowed: vi.fn((provider: string, url: string) => (
    provider === 'youtube' && url.startsWith('https://www.youtube.com/')
  )),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  ImageBackground: 'ImageBackground',
  StyleSheet: {
    absoluteFill: { position: 'absolute', inset: 0 },
    create: (styles: unknown) => styles,
  },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    backgroundSecondary: '#eee',
    card: '#fff',
    cardBorder: '#ddd',
    text: '#111',
    textMuted: '#666',
    tint: '#a43',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'DMSans_600SemiBold' },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18 },
  fontWeight: { semibold: '600', bold: '700' },
  radius: { md: 12, lg: 16, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
}));
vi.mock('../lib/sourcePlayback', () => ({
  getAutoplayEmbedUrl: (playback: SourcePlayback) => `${playback.embedUrl}&autoplay=1`,
  isSourcePlaybackNavigationAllowed: navigationAllowed,
}));

import { SourcePlaybackCard } from './SourcePlaybackCard';

const youtubePlayback: SourcePlayback = {
  provider: 'youtube',
  providerLabel: 'YouTube',
  embedUrl: 'https://www.youtube.com/embed/abcDEF_1234?playsinline=1',
  aspectRatio: 16 / 9,
  requestHeaders: { Referer: 'https://com.shimizutechnology.recipeextractor' },
};

describe('SourcePlaybackCard', () => {
  it('loads the official player only after the cook asks to play', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(SourcePlaybackCard, {
          playback: youtubePlayback,
          recipeTitle: 'Chicken Kelaguen',
          thumbnailUrl: 'https://example.com/thumbnail.jpg',
          onOpenSource: vi.fn(),
        }));
      });
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'WebView',
      )).toHaveLength(0);

      const playButton = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel
        === 'Play the YouTube video for Chicken Kelaguen');
      await act(async () => playButton!.props.onPress());

      const webView = renderer.container.queryAll(
        (instance) => instance.type === 'WebView',
      )[0];
      expect(webView.props.source).toEqual({
        uri: `${youtubePlayback.embedUrl}&autoplay=1`,
        headers: youtubePlayback.requestHeaders,
      });
      expect(webView.props.originWhitelist).toEqual(['*']);
      expect(webView.props.setSupportMultipleWindows).toBe(false);
      expect(webView.props.onShouldStartLoadWithRequest({
        url: 'https://www.youtube.com/watch?v=abcDEF_1234',
      })).toBe(true);
      expect(webView.props.onShouldStartLoadWithRequest({
        url: 'https://apps.apple.com/app/youtube/id544007664',
      })).toBe(false);
      expect(webView.props.onShouldStartLoadWithRequest({
        url: 'youtube://watch?v=abcDEF_1234',
      })).toBe(false);
      webView.props.onOpenWindow({
        nativeEvent: { targetUrl: 'https://apps.apple.com/app/youtube/id544007664' },
      });
      expect(navigationAllowed).toHaveBeenCalledWith(
        'youtube',
        'https://apps.apple.com/app/youtube/id544007664',
      );
      expect(webView.props.allowsInlineMediaPlayback).toBe(true);
      expect(webView.props.allowsFullscreenVideo).toBe(true);
      expect(webView.props.mediaPlaybackRequiresUserAction).toBe(false);
      expect(webView.props.accessibilityLabel).toBe('YouTube player for Chicken Kelaguen');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'ActivityIndicator',
      )).toHaveLength(1);
      await act(async () => webView.props.onLoadProgress({ nativeEvent: { progress: 0.8 } }));
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'ActivityIndicator',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('offers retry and the exact original when an embed is unavailable', async () => {
    const onOpenSource = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(SourcePlaybackCard, {
          playback: youtubePlayback,
          recipeTitle: 'Chicken Kelaguen',
          onOpenSource,
        }));
      });
      const playButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'Play the YouTube video for Chicken Kelaguen',
      )[0];
      await act(async () => playButton.props.onPress());
      const webView = renderer.container.queryAll(
        (instance) => instance.type === 'WebView',
      )[0];
      await act(async () => webView.props.onHttpError({ nativeEvent: { statusCode: 404 } }));

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'WebView',
      )).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'Retry YouTube player for Chicken Kelaguen',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'View'
          && instance.props.style?.backgroundColor === 'rgba(20, 12, 8, 0.82)',
      )).toHaveLength(1);
      const openOriginal = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open original recipe on YouTube',
      )[0];
      await act(async () => openOriginal.props.onPress());
      expect(onOpenSource).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

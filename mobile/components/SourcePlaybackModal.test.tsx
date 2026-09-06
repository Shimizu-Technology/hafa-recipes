import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModalSourcePlayback } from '@/lib/sourcePlayback';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const appState = vi.hoisted(() => ({
  listener: undefined as ((state: string) => void) | undefined,
  remove: vi.fn(),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: {
    addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
      appState.listener = listener;
      return { remove: appState.remove };
    }),
  },
  Modal: 'Modal',
  StyleSheet: {
    hairlineWidth: 1,
    create: (styles: unknown) => styles,
  },
  TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    background: '#fff7ec',
    backgroundSecondary: '#f8efe3',
    border: '#e8d8c8',
    text: '#17120e',
    textSecondary: '#6d5d50',
    textMuted: '#756659',
    tint: '#155c52',
  }),
}));

import {
  containedPlayerSize,
  SOURCE_PLAYER_LOAD_TIMEOUT_MS,
  SourcePlaybackModal,
} from './SourcePlaybackModal';

const youtubePlayback: ModalSourcePlayback = {
  mode: 'modal',
  provider: 'youtube',
  providerLabel: 'YouTube',
  mediaKind: 'video',
  embedUrl: 'https://www.youtube-nocookie.com/embed/abcDEF_1234?playsinline=1&rel=0',
  aspectRatio: 16 / 9,
  requestHeaders: { Referer: 'https://com.shimizutechnology.recipeextractor' },
};

async function renderModal(overrides: Partial<React.ComponentProps<typeof SourcePlaybackModal>> = {}) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  const onClose = vi.fn();
  const onRequestOpenSource = vi.fn();
  await act(async () => {
    renderer.render(React.createElement(SourcePlaybackModal, {
      visible: true,
      playback: youtubePlayback,
      recipeTitle: 'Chicken Kelaguen',
      onClose,
      onRequestOpenSource,
      ...overrides,
    }));
  });
  const playerStage = renderer.container.queryAll(
    (instance) => instance.props.testID === 'player-stage',
  )[0];
  await act(async () => playerStage.props.onLayout({
    nativeEvent: { layout: { width: 390, height: 587 } },
  }));
  return { renderer, onClose, onRequestOpenSource };
}

afterEach(() => {
  vi.useRealTimers();
  appState.listener = undefined;
  appState.remove.mockReset();
});

describe('containedPlayerSize', () => {
  it('fits landscape and portrait players within both axes', () => {
    expect(containedPlayerSize(390, 587, 16 / 9)).toEqual({ width: 390, height: 219.375 });
    expect(containedPlayerSize(390, 587, 9 / 16)).toEqual({ width: 330.1875, height: 587 });
    expect(containedPlayerSize(180, 160, 16 / 9)).toEqual({ width: 180, height: 101.25 });
  });

  it('announces document readiness without placing status over the player', async () => {
    const { renderer } = await renderModal();
    try {
      const modal = renderer.container.queryAll((instance) => instance.type === 'Modal')[0];
      await act(async () => modal.props.onShow());
      const webView = renderer.container.queryAll((instance) => instance.type === 'WebView')[0];
      await act(async () => webView.props.onLoadEnd());

      expect(renderer.container.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.props.children === 'Loaded from YouTube',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.props.children?.join?.('')
          === 'Player provided by YouTube. Its privacy terms apply.',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

describe('SourcePlaybackModal', () => {
  it('waits for the modal transition before mounting the exact provider player', async () => {
    const { renderer } = await renderModal();
    try {
      expect(renderer.container.queryAll((instance) => instance.type === 'WebView')).toHaveLength(0);
      const modal = renderer.container.queryAll((instance) => instance.type === 'Modal')[0];

      await act(async () => modal.props.onShow());

      const webView = renderer.container.queryAll((instance) => instance.type === 'WebView')[0];
      expect(webView.props.source).toEqual({
        uri: `${youtubePlayback.embedUrl}&autoplay=1`,
        headers: youtubePlayback.requestHeaders,
      });
      expect(webView.props.originWhitelist).toEqual(['*']);
      expect(webView.props.setSupportMultipleWindows).toBe(false);
      expect(webView.props.mixedContentMode).toBe('never');
      expect(webView.props.onShouldStartLoadWithRequest({
        url: `${youtubePlayback.embedUrl}&autoplay=1`,
      })).toBe(true);
      expect(webView.props.onShouldStartLoadWithRequest({
        url: 'https://www.youtube.com/watch?v=abcDEF_1234',
      })).toBe(false);
      expect(webView.props.onShouldStartLoadWithRequest({
        url: 'youtube://watch?v=abcDEF_1234',
      })).toBe(false);

      const playerRegion = renderer.container.queryAll(
        (instance) => instance.props.testID === 'provider-player-region',
      )[0];
      expect(playerRegion.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(playerRegion.queryAll((instance) => instance.type === 'WebView')).toHaveLength(1);
      expect(renderer.container.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('waits for measured stage dimensions when the modal transition finishes first', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => {
        renderer.render(React.createElement(SourcePlaybackModal, {
          visible: true,
          playback: youtubePlayback,
          recipeTitle: 'Chicken Kelaguen',
          onClose: vi.fn(),
          onRequestOpenSource: vi.fn(),
        }));
      });
      const modal = renderer.container.queryAll((instance) => instance.type === 'Modal')[0];
      await act(async () => modal.props.onShow());
      expect(renderer.container.queryAll((instance) => instance.type === 'WebView')).toHaveLength(0);

      const playerStage = renderer.container.queryAll(
        (instance) => instance.props.testID === 'player-stage',
      )[0];
      await act(async () => playerStage.props.onLayout({
        nativeEvent: { layout: { width: 330, height: 587 } },
      }));

      const playerRegion = renderer.container.queryAll(
        (instance) => instance.props.testID === 'provider-player-region',
      )[0];
      expect(playerRegion.props.style).toEqual(expect.arrayContaining([
        expect.objectContaining({ width: 330, height: 200 }),
      ]));
      expect(playerRegion.queryAll((instance) => instance.type === 'WebView')).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('replaces a failed player with distinct retry and original actions', async () => {
    const { renderer, onClose, onRequestOpenSource } = await renderModal();
    try {
      const modal = renderer.container.queryAll((instance) => instance.type === 'Modal')[0];
      await act(async () => modal.props.onShow());
      const firstWebView = renderer.container.queryAll((instance) => instance.type === 'WebView')[0];
      await act(async () => firstWebView.props.onHttpError({ nativeEvent: { statusCode: 404 } }));
      await act(async () => firstWebView.props.onLoadEnd());

      expect(renderer.container.queryAll((instance) => instance.type === 'WebView')).toHaveLength(0);
      const alerts = renderer.container.queryAll(
        (instance) => instance.props.accessibilityRole === 'alert',
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0].queryAll((instance) => instance.type === 'TouchableOpacity')).toHaveLength(0);

      const retry = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Try loading the YouTube player again',
      )[0];
      await act(async () => retry.props.onPress());
      const retriedWebView = renderer.container.queryAll((instance) => instance.type === 'WebView')[0];
      expect(retriedWebView).not.toBe(firstWebView);

      await act(async () => retriedWebView.props.onError());
      const originalActions = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open original on YouTube',
      );
      expect(originalActions).toHaveLength(1);
      const openOriginal = originalActions[0];
      await act(async () => openOriginal.props.onPress());
      expect(onClose).not.toHaveBeenCalled();
      expect(onRequestOpenSource).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('turns a hung provider document into a recoverable error', async () => {
    vi.useFakeTimers();
    const { renderer } = await renderModal();
    try {
      const modal = renderer.container.queryAll((instance) => instance.type === 'Modal')[0];
      await act(async () => modal.props.onShow());
      await act(async () => vi.advanceTimersByTime(SOURCE_PLAYER_LOAD_TIMEOUT_MS));

      expect(renderer.container.queryAll((instance) => instance.type === 'WebView')).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityRole === 'alert',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('loads the exact TikTok photo player without autoplay or navigable feed escape', async () => {
    const tiktokPlayback: ModalSourcePlayback = {
      mode: 'modal',
      provider: 'tiktok',
      providerLabel: 'TikTok',
      mediaKind: 'photo',
      embedUrl: 'https://www.tiktok.com/player/v1/7412345678901234568?autoplay=0',
      aspectRatio: 9 / 16,
    };
    const { renderer, onRequestOpenSource } = await renderModal({ playback: tiktokPlayback });
    try {
      const modal = renderer.container.queryAll((instance) => instance.type === 'Modal')[0];
      await act(async () => modal.props.onShow());
      const webView = renderer.container.queryAll((instance) => instance.type === 'WebView')[0];

      expect(webView.props.source.uri).toBe(tiktokPlayback.embedUrl);
      expect(webView.props.onShouldStartLoadWithRequest({
        url: `${tiktokPlayback.embedUrl}&description=1`,
      })).toBe(true);
      expect(webView.props.onShouldStartLoadWithRequest({
        url: 'https://www.tiktok.com/@cook/photo/7412345678901234568',
      })).toBe(false);
      expect(webView.props.onOpenWindow({
        nativeEvent: { targetUrl: 'https://www.tiktok.com/explore' },
      })).toBeUndefined();
      expect(webView.props.onOpenWindow({
        nativeEvent: { targetUrl: tiktokPlayback.embedUrl },
      })).toBeUndefined();
      expect(onRequestOpenSource).not.toHaveBeenCalled();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('uses the same close path for Android back and app backgrounding', async () => {
    const { renderer, onClose } = await renderModal();
    try {
      const modal = renderer.container.queryAll((instance) => instance.type === 'Modal')[0];
      await act(async () => modal.props.onRequestClose());
      expect(onClose).toHaveBeenCalledOnce();

      await act(async () => appState.listener?.('background'));
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => renderer.unmount());
    }
    expect(appState.remove).toHaveBeenCalledOnce();
  });
});

import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { SourcePlayback } from '@/lib/sourcePlayback';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: {
    absoluteFill: { position: 'absolute', inset: 0 },
    create: (styles: unknown) => styles,
  },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    card: '#fff',
    cardBorder: '#ddd',
    text: '#111',
    textMuted: '#666',
    tint: '#155c52',
  }),
}));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'RecipeThumbnail' }));
vi.mock('./SourcePlaybackModal', () => ({ SourcePlaybackModal: 'SourcePlaybackModal' }));

import { SourcePlaybackCard } from './SourcePlaybackCard';

const youtubePlayback: SourcePlayback = {
  mode: 'modal',
  provider: 'youtube',
  providerLabel: 'YouTube',
  mediaKind: 'video',
  embedUrl: 'https://www.youtube.com/embed/abcDEF_1234?playsinline=1',
  aspectRatio: 16 / 9,
  requestHeaders: { Referer: 'https://com.shimizutechnology.recipeextractor' },
};

const renderCard = async (playback: SourcePlayback, onOpenSource = vi.fn()) => {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => {
    renderer.render(React.createElement(SourcePlaybackCard, {
      playback,
      recipeTitle: 'Chicken Kelaguen',
      thumbnailUrl: 'https://example.com/thumbnail.jpg',
      onOpenSource,
    }));
  });
  return { renderer, onOpenSource };
};

describe('SourcePlaybackCard', () => {
  it('opens YouTube in a modal without mounting a player inline', async () => {
    const { renderer } = await renderCard(youtubePlayback);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )).toHaveLength(0);
      const preview = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'Play YouTube video for Chicken Kelaguen',
      )[0];
      expect(preview.props.accessibilityHint).toBe(
        'Loading this player connects to YouTube; its privacy terms apply',
      );

      await act(async () => preview.props.onPress());

      const modal = renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )[0];
      expect(modal.props).toMatchObject({ visible: true, playback: youtubePlayback });
      await act(async () => modal.props.onClose());
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('turns a modal provider into one external action when playback is rolled back', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    const onOpenSource = vi.fn();
    try {
      await act(async () => {
        renderer.render(React.createElement(SourcePlaybackCard, {
          playback: youtubePlayback,
          recipeTitle: 'Chicken Kelaguen',
          thumbnailUrl: 'https://example.com/thumbnail.jpg',
          onOpenSource,
          embeddedPlaybackEnabled: false,
        }));
      });

      const externalAction = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'Watch original video on YouTube for Chicken Kelaguen',
      )[0];
      expect(externalAction.props.accessibilityRole).toBe('link');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )).toHaveLength(0);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityRole === 'link',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.props.children === 'YouTube opens in its app or website.',
      )).toHaveLength(1);

      await act(async () => externalAction.props.onPress());
      expect(onOpenSource).toHaveBeenCalledOnce();
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('removes the WebView-owning modal before opening the original source', async () => {
    let modalCountWhenSourceOpened: number | null = null;
    let renderer: Awaited<ReturnType<typeof renderCard>>['renderer'];
    const onOpenSource = vi.fn(() => {
      modalCountWhenSourceOpened = renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      ).length;
    });
    ({ renderer } = await renderCard(youtubePlayback, onOpenSource));
    try {
      const preview = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'Play YouTube video for Chicken Kelaguen',
      )[0];
      await act(async () => preview.props.onPress());
      const modal = renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )[0];

      await act(async () => modal.props.onRequestOpenSource());
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )).toHaveLength(0);
      expect(onOpenSource).toHaveBeenCalledOnce();
      expect(modalCountWhenSourceOpened).toBe(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('describes a TikTok photo as a photo post instead of a video', async () => {
    const photoPlayback: SourcePlayback = {
      mode: 'modal',
      provider: 'tiktok',
      providerLabel: 'TikTok',
      mediaKind: 'photo',
      embedUrl: 'https://www.tiktok.com/player/v1/7412345678901234568?autoplay=0',
      aspectRatio: 9 / 16,
    };
    const { renderer } = await renderCard(photoPlayback);
    try {
      const preview = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'View TikTok photo post for Chicken Kelaguen',
      )[0];
      expect(preview).toBeDefined();
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Ionicons' && instance.props.name === 'images-outline',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('opens Instagram externally and never mounts a modal', async () => {
    const instagramPlayback: SourcePlayback = {
      mode: 'external',
      provider: 'instagram',
      providerLabel: 'Instagram',
      mediaKind: 'reel',
    };
    const onOpenSource = vi.fn();
    const { renderer } = await renderCard(instagramPlayback, onOpenSource);
    try {
      const preview = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'Watch original Reel on Instagram for Chicken Kelaguen',
      )[0];
      expect(preview.props.accessibilityRole).toBe('link');
      expect(preview.props.accessibilityHint).toBe('Opens the original source outside Håfa Recipes');
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityRole === 'link',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open original recipe on Instagram',
      )).toHaveLength(0);

      await act(async () => preview.props.onPress());

      expect(onOpenSource).toHaveBeenCalledOnce();
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackModal',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps the cached thumbnail and original-source action available', async () => {
    const onOpenSource = vi.fn();
    const { renderer } = await renderCard(youtubePlayback, onOpenSource);
    try {
      const thumbnail = renderer.container.queryAll(
        (instance) => instance.type === 'RecipeThumbnail',
      )[0];
      expect(thumbnail.props).toMatchObject({
        uri: 'https://example.com/thumbnail.jpg',
        accessible: false,
        priority: 'high',
      });

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

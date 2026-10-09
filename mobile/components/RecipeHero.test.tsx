import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({ tint: '#155C52', textSecondary: '#666666' }),
}));
const playbackPolicy = vi.hoisted(() => ({ mode: 'embedded' }));
vi.mock('../lib/sourcePlaybackConfig', () => ({
  getSourcePlaybackMode: () => playbackPolicy.mode,
}));
vi.mock('./SourcePlaybackCard', () => ({ SourcePlaybackCard: 'SourcePlaybackCard' }));

import { RecipeHero } from './RecipeHero';

const commonProps = {
  recipeTitle: 'Chicken Kelaguen',
  onOpenSource: vi.fn(),
};

afterEach(() => {
  playbackPolicy.mode = 'embedded';
});

describe('RecipeHero', () => {
  it('uses the official player as the hero for a playable source', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeHero, {
          ...commonProps,
          sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234',
          thumbnailUrl: 'https://example.com/kelaguen.jpg',
        }));
      });

      const player = renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackCard',
      )[0];
      expect(player.props.playback).toMatchObject({
        provider: 'youtube',
        mode: 'modal',
        mediaKind: 'video',
      });
      expect(player.props.thumbnailUrl).toBe('https://example.com/kelaguen.jpg');
      expect(player.props.embeddedPlaybackEnabled).toBe(true);
      expect(renderer.container.queryAll((instance) => instance.type === 'Image')).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps Instagram as an explicit external hero action', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeHero, {
          ...commonProps,
          sourceUrl: 'https://www.instagram.com/reel/Example_42/',
          thumbnailUrl: 'https://example.com/kelaguen.jpg',
        }));
      });

      const sourceCard = renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackCard',
      )[0];
      expect(sourceCard.props.playback).toEqual({
        provider: 'instagram',
        providerLabel: 'Instagram',
        mode: 'external',
        mediaKind: 'reel',
      });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('passes an external-only release policy through the recipe hero', async () => {
    playbackPolicy.mode = 'external';
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeHero, {
          ...commonProps,
          sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234',
          thumbnailUrl: 'https://example.com/kelaguen.jpg',
        }));
      });

      const player = renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackCard',
      )[0];
      expect(player.props.embeddedPlaybackEnabled).toBe(false);
      expect(player.props.playback).toMatchObject({ provider: 'youtube', mode: 'modal' });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('collapses failed social photos and recovers on replacement without accepting old failures', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    const props = { ...commonProps, sourceUrl: 'https://www.instagram.com/reel/Example_42/', thumbnailUrl: 'https://example.com/old.jpg' };
    try {
      await act(async () => renderer.render(React.createElement(RecipeHero, props)));
      const oldCard = renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackCard')[0];
      await act(async () => oldCard.props.onThumbnailError());
      expect(renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackCard')[0].props.thumbnailUrl).toBeNull();
      await act(async () => renderer.render(React.createElement(RecipeHero, { ...props, thumbnailUrl: 'https://example.com/new.jpg' })));
      await act(async () => oldCard.props.onThumbnailError());
      expect(renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackCard')[0].props.thumbnailUrl).toBe('https://example.com/new.jpg');
    } finally { await act(async () => renderer.unmount()); }
  });

  it('falls back to the recipe image when the source is not playable', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeHero, {
          ...commonProps,
          sourceUrl: 'https://example.com/recipes/kelaguen',
          thumbnailUrl: 'https://example.com/kelaguen.jpg',
        }));
      });

      const image = renderer.container.queryAll((instance) => instance.type === 'ExpoImage')[0];
      expect(image.props.source).toEqual({ uri: 'https://example.com/kelaguen.jpg' });
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Chicken Kelaguen recipe',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackCard',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows bounded pending feedback while keeping source access and replaces it with the photo', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    const props = { ...commonProps, sourceUrl: 'https://www.instagram.com/reel/Example_42/', thumbnailUrl: null, thumbnailPending: true };
    try {
      await act(async () => renderer.render(React.createElement(RecipeHero, props)));
      expect(renderer.container.queryAll((instance) => instance.props.accessibilityLiveRegion === 'polite')[0].props.children).toBe('Choosing recipe photo…');
      expect(renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackCard')[0].props.onOpenSource).toBe(commonProps.onOpenSource);
      await act(async () => renderer.render(React.createElement(RecipeHero, { ...props, thumbnailUrl: 'https://images/food.webp', thumbnailPending: false })));
      expect(renderer.container.queryAll((instance) => instance.props.accessibilityLiveRegion === 'polite')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackCard')[0].props.thumbnailUrl).toBe('https://images/food.webp');
    } finally { await act(async () => renderer.unmount()); }
  });

  it('keeps an existing photo unobstructed while its replacement is selected', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(React.createElement(RecipeHero, { ...commonProps, sourceUrl: 'manual://recipe', thumbnailUrl: 'https://images/food.webp', thumbnailPending: true })));
      expect(renderer.container.queryAll((instance) => instance.props.accessibilityLiveRegion === 'polite')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'ExpoImage')).toHaveLength(1);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('omits an empty photo area when no image is available', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeHero, {
          ...commonProps,
          sourceUrl: 'manual://recipe',
          thumbnailUrl: null,
        }));
      });

      expect(renderer.container.queryAll((instance) => instance.props.accessibilityRole === 'image')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'ExpoImage')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'Ionicons')).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('treats a whitespace-only thumbnail as unavailable', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeHero, {
          ...commonProps,
          sourceUrl: 'manual://recipe',
          thumbnailUrl: '   ',
        }));
      });

      expect(renderer.container.queryAll((instance) => instance.props.accessibilityRole === 'image')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'ExpoImage')).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

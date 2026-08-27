import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  useColors: () => ({ tint: '#155C52' }),
}));
vi.mock('./SourcePlaybackCard', () => ({ SourcePlaybackCard: 'SourcePlaybackCard' }));

import { RecipeHero } from './RecipeHero';

const commonProps = {
  recipeTitle: 'Chicken Kelaguen',
  imageError: false,
  onImageError: vi.fn(),
  onOpenSource: vi.fn(),
};

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
      expect(player.props.playback).toMatchObject({ provider: 'youtube' });
      expect(player.props.thumbnailUrl).toBe('https://example.com/kelaguen.jpg');
      expect(renderer.container.queryAll((instance) => instance.type === 'Image')).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
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

      const image = renderer.container.queryAll((instance) => instance.type === 'Image')[0];
      expect(image.props.source).toEqual({ uri: 'https://example.com/kelaguen.jpg' });
      expect(image.props.accessibilityLabel).toBe('Chicken Kelaguen recipe');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'SourcePlaybackCard',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('uses an accessible placeholder when no usable image remains', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeHero, {
          ...commonProps,
          sourceUrl: 'manual://recipe',
          thumbnailUrl: null,
        }));
      });

      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel
          === 'Chicken Kelaguen recipe image placeholder',
      )).toHaveLength(1);
      expect(renderer.container.queryAll((instance) => instance.type === 'Ionicons')).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

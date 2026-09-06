import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ useColors: () => ({ tint: '#155c52' }) }));

import { RecipeThumbnail } from './RecipeThumbnail';

describe('RecipeThumbnail', () => {
  it('paints a placeholder under a cached, recyclable image request', async () => {
    const renderer = createRoot();
    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeThumbnail, {
          uri: 'https://example.com/recipe.jpg',
          style: { width: 160, height: 120 },
          accessibilityLabel: 'Chicken kelaguen photo',
          priority: 'high',
        }));
      });

      expect(renderer.container.queryAll((instance) => instance.type === 'Ionicons')).toHaveLength(1);
      const image = renderer.container.queryAll((instance) => instance.type === 'ExpoImage')[0];
      expect(image.props).toMatchObject({
        cachePolicy: 'memory-disk',
        contentFit: 'cover',
        recyclingKey: 'https://example.com/recipe.jpg',
        priority: 'high',
        transition: 150,
        autoplay: false,
      });
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Chicken kelaguen photo',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('falls back after an error and retries when the URL changes', async () => {
    const renderer = createRoot();
    const onError = vi.fn();
    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeThumbnail, {
          uri: 'https://example.com/missing.jpg',
          style: { width: 80, height: 80 },
          onError,
        }));
      });
      const image = renderer.container.queryAll((instance) => instance.type === 'ExpoImage')[0];
      await act(async () => image.props.onError({ error: 'not found' }));
      expect(onError).toHaveBeenCalledOnce();
      expect(renderer.container.queryAll((instance) => instance.type === 'ExpoImage')).toHaveLength(0);

      await act(async () => {
        renderer.render(React.createElement(RecipeThumbnail, {
          uri: 'https://example.com/replacement.jpg',
          style: { width: 80, height: 80 },
          onError,
        }));
      });
      expect(renderer.container.queryAll(
        (instance) => instance.props.recyclingKey === 'https://example.com/replacement.jpg',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows only the placeholder when no usable URL exists', async () => {
    const renderer = createRoot();
    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeThumbnail, {
          uri: '   ',
          style: { width: 80, height: 80 },
        }));
      });
      expect(renderer.container.queryAll((instance) => instance.type === 'ExpoImage')).toHaveLength(0);
      expect(renderer.container.queryAll((instance) => instance.type === 'Ionicons')).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('can suppress nested image semantics without changing placeholder overlays', async () => {
    const renderer = createRoot();
    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeThumbnail, {
          uri: null,
          style: { width: 160, height: 90 },
          accessible: false,
          overlay: React.createElement('OverlayAction'),
        }));
      });

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'OverlayAction',
      )).toHaveLength(0);
      const wrapper = renderer.container.queryAll(
        (instance) => instance.type === 'NativeView',
      )[0];
      expect(wrapper.props.accessible).toBe(false);
      expect(wrapper.props.accessibilityRole).toBeUndefined();
      expect(wrapper.props.accessibilityLabel).toBeUndefined();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    backgroundSecondary: '#fff',
    text: '#111',
    textMuted: '#666',
    tint: '#b44',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 12, sm: 14, md: 16 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { full: 999, md: 12, lg: 16 },
  spacing: { sm: 8, md: 16, lg: 24 },
}));

import { PlannerRecipeHandoffCard } from './PlannerRecipeHandoffCard';

function textNodes(renderer: ReturnType<typeof createRoot>) {
  return renderer.container.queryAll((instance) => instance.type === 'Text');
}

describe('PlannerRecipeHandoffCard', () => {
  it('shows a loading state while the recipe or authentication is resolving', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(PlannerRecipeHandoffCard, {
          isLoading: true,
          hasError: false,
          isRetrying: false,
          onRetry: vi.fn(),
          onDismiss: vi.fn(),
        }));
      });

      expect(textNodes(renderer).some(
        (text) => text.props.children === 'Loading recipe to plan...',
      )).toBe(true);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'ActivityIndicator',
      )).toHaveLength(1);
      expect(textNodes(renderer).some(
        (text) => text.props.children === "We couldn't load this recipe.",
      )).toBe(false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows the authoritative recipe and lets the user dismiss the handoff', async () => {
    const onDismiss = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(PlannerRecipeHandoffCard, {
          title: 'Chicken Kelaguen',
          thumbnailUrl: 'https://example.com/kelaguen.jpg',
          isLoading: false,
          hasError: false,
          isRetrying: false,
          onRetry: vi.fn(),
          onDismiss,
        }));
      });

      expect(textNodes(renderer).some((text) => text.props.children === 'Chicken Kelaguen')).toBe(true);
      const dismiss = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Stop planning this recipe');
      await act(async () => dismiss!.props.onPress());
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows an accessible fallback when the loaded recipe has no thumbnail', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(PlannerRecipeHandoffCard, {
          title: 'Red Rice',
          thumbnailUrl: null,
          isLoading: false,
          hasError: false,
          isRetrying: false,
          onRetry: vi.fn(),
          onDismiss: vi.fn(),
        }));
      });

      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Recipe thumbnail unavailable',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('offers retry or dismissal when the recipe cannot be loaded', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(PlannerRecipeHandoffCard, {
          isLoading: false,
          hasError: true,
          isRetrying: false,
          onRetry,
          onDismiss,
        }));
      });

      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      await act(async () => buttons.find(
        (button) => button.props.accessibilityLabel === 'Retry recipe load',
      )!.props.onPress());
      await act(async () => buttons.find(
        (button) => button.props.accessibilityLabel === 'Choose a different recipe',
      )!.props.onPress());

      expect(onRetry).toHaveBeenCalledOnce();
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('disables retry and announces progress while refetching', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(PlannerRecipeHandoffCard, {
          isLoading: false,
          hasError: true,
          isRetrying: true,
          onRetry: vi.fn(),
          onDismiss: vi.fn(),
        }));
      });

      const retry = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      ).find((button) => button.props.accessibilityLabel === 'Retrying recipe load');
      expect(retry?.props.disabled).toBe(true);
      expect(retry?.props.accessibilityState).toEqual({ busy: true, disabled: true });
      expect(textNodes(renderer).some((text) => text.props.children === 'Retrying...')).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

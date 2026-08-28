import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    StyleSheet: { create: <T,>(styles: T) => styles },
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  return {
    Text: (props: Record<string, unknown>) =>
      ReactModule.createElement('ThemedText', props, props.children as React.ReactNode),
    useColors: () => ({
      accent: '#b94722',
      accentSoft: '#fbe8de',
      backgroundElevated: '#fffdf8',
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      text: '#111',
      textMuted: '#666',
      textSecondary: '#555',
      tint: '#155c52',
    }),
  };
});
vi.mock('@/constants/Colors', () => ({
  fontFamily: { displaySemibold: 'Fraunces' },
  fontSize: { xs: 10, md: 14, lg: 18 },
  fontWeight: { semibold: '600' },
  radius: { md: 8, lg: 12 },
  spacing: { sm: 8, md: 16, lg: 24 },
}));

import { RecipeVisibilitySelector } from '../components/RecipeVisibilitySelector';

function getOption(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
    .find((node) => node.props.accessibilityLabel === label)!;
}

describe('RecipeVisibilitySelector', () => {
  it('announces the exact selected visibility', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(RecipeVisibilitySelector, {
          value: 'public',
          onChange: vi.fn(),
        }),
      );
    });

    expect(getOption(renderer!, 'Private').props.accessibilityState.checked).toBe(false);
    expect(getOption(renderer!, 'Public in Discover').props.accessibilityState.checked).toBe(true);
  });

  it('reports the requested choice without changing it internally', async () => {
    const onChange = vi.fn();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(RecipeVisibilitySelector, {
          value: 'private',
          onChange,
        }),
      );
    });

    await act(async () => getOption(renderer!, 'Public in Discover').props.onPress());

    expect(onChange).toHaveBeenCalledWith('public');
    expect(getOption(renderer!, 'Private').props.accessibilityState.checked).toBe(true);
  });

  it('disables both choices while visibility is being verified', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(RecipeVisibilitySelector, {
          value: 'private',
          onChange: vi.fn(),
          disabled: true,
        }),
      );
    });

    expect(getOption(renderer!, 'Private').props.disabled).toBe(true);
    expect(getOption(renderer!, 'Public in Discover').props.disabled).toBe(true);
  });
});

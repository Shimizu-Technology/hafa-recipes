import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  return {
    Text: (props: Record<string, unknown>) =>
      ReactModule.createElement('Text', props, props.children as React.ReactNode),
    useColors: () => ({
      accent: '#b94722',
      accentSoft: '#fbe8de',
      backgroundElevated: '#fffdf8',
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      text: '#111',
      textMuted: '#666',
      textSecondary: 'rgba(235,235,245,0.60)',
      surface2: 'rgba(118,118,128,0.24)',
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

const reactNativeShim = await import('./react-native-shim');
// @ts-expect-error Node's module loader is available in Vitest but excluded from Expo app types.
const nodeModule = await import('node:module');
type ModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;
const commonJsModule = nodeModule.default as typeof nodeModule.default & {
  _load: ModuleLoader;
};
const originalLoad = commonJsModule._load;
commonJsModule._load = (request: string, parent: unknown, isMain: boolean) =>
  request === 'react-native'
    ? reactNativeShim
    : originalLoad(request, parent, isMain);

let testingLibrary: typeof import('@testing-library/react-native/pure');
try {
  testingLibrary = await import('@testing-library/react-native/pure');
} finally {
  commonJsModule._load = originalLoad;
}
const { fireEvent, render } = testingLibrary;

import { RecipeVisibilitySelector } from '../components/RecipeVisibilitySelector';

describe('RecipeVisibilitySelector', () => {
  it('announces the exact selected visibility', async () => {
    const screen = await render(
      <RecipeVisibilitySelector value="public" onChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('Private').props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('Public in Discover').props.accessibilityState.checked).toBe(true);
  });

  it('keeps selected fills valid when the secondary text token is RGBA', async () => {
    const screen = await render(<RecipeVisibilitySelector value="public" onChange={vi.fn()} />);
    for (const label of ['Private', 'Public in Discover']) {
      const colors = screen.getByLabelText(label).props.style.flat().filter(Boolean).flatMap((style: Record<string, unknown>) => [style.backgroundColor, style.borderColor]).filter(Boolean);
      for (const color of colors) expect(color).toMatch(/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$/i);
    }
  });

  it('reports the requested choice without changing it internally', async () => {
    const onChange = vi.fn();
    const screen = await render(
      <RecipeVisibilitySelector value="private" onChange={onChange} />,
    );

    await fireEvent.press(screen.getByLabelText('Public in Discover'));

    expect(onChange).toHaveBeenCalledWith('public');
    expect(screen.getByLabelText('Private').props.accessibilityState.checked).toBe(true);
  });

  it('disables both choices while visibility is being verified', async () => {
    const screen = await render(
      <RecipeVisibilitySelector value="private" onChange={vi.fn()} disabled />,
    );

    expect(screen.getByLabelText('Private').props.disabled).toBe(true);
    expect(screen.getByLabelText('Public in Discover').props.disabled).toBe(true);
  });
});

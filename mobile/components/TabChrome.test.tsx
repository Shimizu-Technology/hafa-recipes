import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  isSignedIn: false,
  imageUrl: null as string | null,
  push: vi.fn(),
}));

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@clerk/expo', () => ({
  useUser: () => ({
    isSignedIn: mocks.isSignedIn,
    user: mocks.isSignedIn ? { imageUrl: mocks.imageUrl } : null,
  }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/BrandMark', () => ({ BrandMark: 'BrandMark' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    backgroundElevated: '#FFFCF7',
    backgroundSecondary: '#F8EFE3',
    border: '#E8D8C8',
    shadowColor: '#0B3E38',
    text: '#17120E',
    tint: '#155C52',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { display: 'Fraunces_700Bold' },
  fontSize: { lg: 18 },
  radius: { full: 999 },
  spacing: { sm: 8 },
}));

import { AccountHeaderButton, ImportTabIcon, TabHeaderBrand } from './TabChrome';

describe('TabChrome', () => {
  beforeEach(() => {
    mocks.isSignedIn = false;
    mocks.imageUrl = null;
    mocks.push.mockReset();
  });

  it('links the global account affordance back to settings for guests', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(<AccountHeaderButton />));
      const button = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open sign in and settings',
      )[0];

      await act(async () => button.props.onPress());
      expect(mocks.push).toHaveBeenCalledWith('/settings');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('uses the signed-in profile image when one is available', async () => {
    mocks.isSignedIn = true;
    mocks.imageUrl = 'https://example.com/profile.jpg';
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(<AccountHeaderButton />));
      const image = renderer.container.queryAll((instance) => instance.type === 'Image')[0];
      expect(image.props.source).toEqual({ uri: mocks.imageUrl });
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Open account and settings',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('renders a branded app header and a visually distinct import action', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(
        <>
          <TabHeaderBrand />
          <ImportTabIcon focused />
        </>,
      ));

      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Håfa Recipes',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Ionicons' && instance.props.name === 'add',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  useColors: () => ({
    accent: '#B94722',
    accentSoft: '#FBE8DE',
    border: '#E8D8C8',
    card: '#FFFCF7',
    shadowColor: '#0B3E38',
    text: '#17120E',
    textSecondary: '#6D5D50',
    tint: '#155C52',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 12, sm: 14 },
  fontWeight: { semibold: '600' },
  radius: { md: 12, xl: 20, full: 999 },
  shadows: { medium: { shadowOpacity: 0.14 } },
  spacing: { xs: 4, sm: 8, md: 16 },
}));

import { SignInBanner } from './SignInBanner';

describe('SignInBanner', () => {
  beforeEach(() => mocks.push.mockReset());

  it('keeps both account paths accessible in a compact guest prompt', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(<SignInBanner message="Sign in to save recipes" />));

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Text' && instance.props.children === 'Sign in to save recipes',
      )).toHaveLength(1);

      const createAccount = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Create account',
      )[0];
      const signIn = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Sign in',
      )[0];

      expect(createAccount.props.accessibilityRole).toBe('button');
      expect(signIn.props.accessibilityRole).toBe('button');

      await act(async () => createAccount.props.onPress());
      await act(async () => signIn.props.onPress());

      expect(mocks.push).toHaveBeenNthCalledWith(1, '/(auth)/sign-up');
      expect(mocks.push).toHaveBeenNthCalledWith(2, '/(auth)/sign-in');
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

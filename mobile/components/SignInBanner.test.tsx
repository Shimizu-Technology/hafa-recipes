import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ fontScale: 1, push: vi.fn() }));

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => ({ fontScale: mocks.fontScale }),
  View: 'View',
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/Themed', () => ({
  useColors: () => ({
    accent: '#B94722',
    accentSoft: '#FBE8DE',
    border: '#E8D8C8',
    card: '#FFFCF7',
    shadowColor: '#0B3E38',
    actionText: '#166456',
    text: '#17120E',
    textSecondary: '#6D5D50',
    tint: '#5DD3B6', onTint: '#00261F',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  radius: { md: 14, full: 999 },
  spacing: { sm: 8, md: 16, lg: 24 },
  typography: { headline: { fontSize: 17, lineHeight: 22 }, subhead: { fontSize: 15, lineHeight: 20 } },
}));

import { SignInBanner } from './SignInBanner';

describe('SignInBanner', () => {
  beforeEach(() => {
    mocks.fontScale = 1;
    mocks.push.mockReset();
  });

  it('keeps both account paths accessible in a calm inline guest card', async () => {
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
      const signInLabel = signIn.queryAll(n => n.type === 'Text')[0];
      expect(Object.assign({}, ...[signInLabel.props.style].flat(Infinity)).color).toBe('#00261F');

      const banner = renderer.container.queryAll(
        (instance) => instance.props.accessibilityRole === 'summary',
      )[0];
      // Inline in the content flow: no absolute position, border or shadow that could sit under the tab bar.
      const card = Object.assign({}, ...[banner.props.style].flat(Infinity));
      expect(card).toMatchObject({ marginBottom: 24, borderRadius: 14 });
      expect(card).not.toHaveProperty('position');
      expect(card).not.toHaveProperty('bottom');
      expect(card).not.toHaveProperty('borderWidth');
      expect(card).not.toHaveProperty('shadowOpacity');

      await act(async () => createAccount.props.onPress());
      await act(async () => signIn.props.onPress());

      expect(mocks.push).toHaveBeenNthCalledWith(1, '/(auth)/sign-up');
      expect(mocks.push).toHaveBeenNthCalledWith(2, '/(auth)/sign-in');
    } finally {
      await act(async () => renderer.unmount());
    }

  });

  it('stacks the account actions at accessibility text sizes', async () => {
    mocks.fontScale = 2;
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(<SignInBanner style={{ marginBottom: 0 }} />));
      const summary = renderer.container.queryAll(
        (instance) => instance.props.accessibilityRole === 'summary',
      )[0];
      expect(Object.assign({}, ...[summary.props.style].flat(Infinity)).marginBottom).toBe(0);

      const signIn = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Sign in',
      )[0];
      const actions = renderer.container.queryAll(
        (instance) => instance.type === 'View' && instance.queryAll((child) => child === signIn).length > 0,
      ).at(-1)!;
      expect(actions.props.style).toContainEqual(expect.objectContaining({ flexDirection: 'column', alignItems: 'stretch' }));
    } finally {
      await act(async () => renderer.unmount());
    }
  });

});

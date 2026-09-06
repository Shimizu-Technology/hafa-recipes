import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const routerMocks = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(),
  replace: vi.fn(),
}));

function host(name: string) {
  return (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
}

vi.mock('react-native', () => ({
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Platform: { OS: 'ios' },
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  TouchableOpacity: host('TouchableOpacity'),
  View: host('NativeView'),
}));
vi.mock('@clerk/expo/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    setActive: vi.fn(),
    signIn: {
      attemptFirstFactor: vi.fn(),
      create: vi.fn(),
    },
  }),
}));
vi.mock('expo-router', () => ({ useRouter: () => routerMocks }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('@/components/BrandMark', () => ({ BrandMark: host('BrandMark') }));
vi.mock('@/components/Themed', () => ({
  Button: ({ title, ...props }: { title: string }) => React.createElement('Button', { title, ...props }),
  Input: host('Input'),
  Text: host('Text'),
  View: host('ThemedView'),
  useColors: () => ({
    background: '#fffaf3',
    backgroundSecondary: '#f5f1ec',
    border: '#ddd',
    error: '#c00',
    success: '#080',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#444',
    tint: '#176b5b',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'DMSans-Semibold' },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 20, xxl: 24, xxxl: 32 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { sm: 8, md: 10, lg: 14, xl: 20, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/lib/accountAccess', () => ({
  clerkErrorMessage: () => 'Could not continue.',
  shouldNavigateAfterSessionActivation: () => true,
}));
vi.mock('@/lib/accountRecovery', () => ({
  sendExistingAccountCode: vi.fn(),
  verifyExistingAccountCode: vi.fn(),
}));
vi.mock('@/lib/clerkMigration', () => ({ CLERK_ENVIRONMENT: 'development' }));

import ForgotPasswordScreen from '../app/(auth)/forgot-password';
import RecoverAccountScreen from '../app/(auth)/recover-account';

const screens = [
  ['password reset', ForgotPasswordScreen],
  ['account recovery', RecoverAccountScreen],
] as const;

describe('authentication recovery Back controls', () => {
  beforeEach(() => {
    routerMocks.back.mockReset();
    routerMocks.canGoBack.mockReset();
    routerMocks.replace.mockReset();
  });

  it.each(screens)('describes history navigation on the %s screen', async (_name, Screen) => {
    routerMocks.canGoBack.mockReturnValue(true);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(Screen)));
      const backButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Back to previous screen',
      )[0];

      expect(backButton.props.accessibilityRole).toBe('button');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it.each(screens)('describes the fallback destination on the %s screen', async (_name, Screen) => {
    routerMocks.canGoBack.mockReturnValue(false);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(Screen)));
      const backButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Back to Håfa Recipes',
      )[0];

      expect(backButton.props.accessibilityRole).toBe('button');
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

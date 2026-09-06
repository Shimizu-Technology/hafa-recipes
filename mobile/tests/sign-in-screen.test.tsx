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
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: vi.fn() },
  Image: host('Image'),
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Platform: { OS: 'ios' },
  ScrollView: host('ScrollView'),
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    flatten: (styles: unknown[]) => Object.assign({}, ...styles),
  },
  TouchableOpacity: host('TouchableOpacity'),
  View: host('NativeView'),
}));
vi.mock('@clerk/expo/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    setActive: vi.fn(),
    signIn: { create: vi.fn() },
  }),
}));
vi.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactElement<{ style?: unknown }> }) => {
    if (Array.isArray(children.props.style)) {
      throw new Error('Link asChild cannot receive an array style');
    }
    return children;
  },
  useRouter: () => routerMocks,
}));
vi.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { EMAIL: 0, FULL_NAME: 1 },
  signInAsync: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'nonce' }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn() }));
vi.mock('expo-linking', () => ({ createURL: () => 'hafa://oauth-callback' }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('@/components/Themed', () => ({
  Button: ({ title, ...props }: { title: string }) => React.createElement('Button', { title, ...props }),
  Input: host('Input'),
  Text: host('Text'),
  View: host('ThemedView'),
  useColors: () => ({
    backgroundSecondary: '#f5f1ec',
    border: '#ddd',
    card: '#fff',
    cardBorder: '#ddd',
    error: '#c00',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#444',
    tint: '#a43',
  }),
}));
vi.mock('@/components/BrandMark', () => ({ BrandMark: host('BrandMark') }));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'DMSans-Semibold' },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 20, xxl: 24, xxxl: 32 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { md: 10, lg: 14, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/lib/accountAccess', () => ({
  clerkErrorMessage: () => 'Could not sign in.',
  isCancelledAppleSignIn: () => false,
  shouldNavigateAfterSessionActivation: () => true,
}));
vi.mock('@/lib/clerkMigration', () => ({ CLERK_ENVIRONMENT: 'development' }));
vi.mock('@/lib/socialAuthentication', () => ({
  signInWithAppleToken: vi.fn(),
  signInWithBrowserProvider: vi.fn(),
}));

import SignInScreen from '../app/(auth)/sign-in';

function renderedText(renderer: ReturnType<typeof createRoot>): string {
  return renderer.container.queryAll((instance) => instance.type === 'Text')
    .flatMap((instance) => instance.props.children ?? [])
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

describe('SignInScreen', () => {
  beforeEach(() => {
    routerMocks.back.mockReset();
    routerMocks.canGoBack.mockReset();
    routerMocks.canGoBack.mockReturnValue(false);
    routerMocks.replace.mockReset();
  });

  it('renders every Link child with a flattened style', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(SignInScreen));
      });

      const copy = renderedText(renderer);
      expect(copy).toContain('Welcome back');
      expect(copy).toContain('Find my existing recipes');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('offers an accessible escape when restored without navigation history', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(SignInScreen));
      });
      const backButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Back to Håfa Recipes',
      )[0];

      expect(backButton.props.accessibilityRole).toBe('button');
      await act(async () => backButton.props.onPress());
      expect(routerMocks.back).not.toHaveBeenCalled();
      expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('describes normal Back navigation without promising the tabs destination', async () => {
    routerMocks.canGoBack.mockReturnValue(true);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(SignInScreen));
      });
      const backButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Back to previous screen',
      )[0];

      expect(backButton.props.accessibilityRole).toBe('button');
      await act(async () => backButton.props.onPress());
      expect(routerMocks.back).toHaveBeenCalledOnce();
      expect(routerMocks.replace).not.toHaveBeenCalled();
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

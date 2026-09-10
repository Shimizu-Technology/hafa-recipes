import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const clerkMocks = vi.hoisted(() => ({ create: vi.fn(), prepareSecondFactor: vi.fn(), attemptSecondFactor: vi.fn(), setActive: vi.fn(), navigate: vi.fn(() => true) }));

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
  TextInput: host('TextInput'),
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
    setActive: clerkMocks.setActive,
    signIn: clerkMocks,
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
  clerkErrorMessage: (_error: unknown, fallback: string) => fallback,
  isCancelledAppleSignIn: () => false,
  shouldNavigateAfterSessionActivation: clerkMocks.navigate,
}));
vi.mock('@/lib/clerkMigration', () => ({ CLERK_ENVIRONMENT: 'development' }));
vi.mock('@/lib/socialAuthentication', () => ({
  MOBILE_OAUTH_CALLBACK_URL: 'hafarecipes://oauth-callback',
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
    Object.values(clerkMocks).forEach((mock) => mock.mockReset());
    clerkMocks.navigate.mockReturnValue(true);
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
      expect(copy).toContain('Restore my library');
      expect(copy).toContain('Forgot your password or changed sign-in methods?');
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
  async function renderPasswordSignIn(result: unknown) {
    clerkMocks.create.mockResolvedValue(result);
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    await act(async () => renderer.render(React.createElement(SignInScreen)));
    const inputs = renderer.container.queryAll((node) => node.type === 'Input');
    await act(async () => {
      inputs[0].props.onChangeText('existing@example.test');
      inputs[1].props.onChangeText('correct-password');
    });
    await press(renderer, 'Sign In');
    return renderer;
  }

  async function press(renderer: ReturnType<typeof createRoot>, title: string) {
    const button = renderer.container.queryAll((node) => node.type === 'Button' && node.props.title === title)[0];
    await act(async () => button.props.onPress());
  }

  async function enterCode(renderer: ReturnType<typeof createRoot>, code: string) {
    const input = renderer.container.queryAll((node) => node.type === 'TextInput')[0];
    await act(async () => input.props.onChangeText(code));
  }

  const emailFactor = { strategy: 'email_code', emailAddressId: 'email_existing', safeIdentifier: 'e***@example.test' };

  it.each(['needs_second_factor', 'needs_client_trust'])('completes %s email verification on the same sign-in', async (status) => {
    const renderer = await renderPasswordSignIn({ status, supportedSecondFactors: [emailFactor] });
    try {
      expect(renderedText(renderer)).toContain('Verify your sign-in');
      expect(renderedText(renderer)).not.toContain('disable 2FA');
      expect(clerkMocks.prepareSecondFactor).toHaveBeenCalledWith({ strategy: 'email_code', emailAddressId: 'email_existing' });
      expect(clerkMocks.setActive).not.toHaveBeenCalled();
      clerkMocks.attemptSecondFactor.mockResolvedValue({ status: 'complete', createdSessionId: 'session_existing' });
      await enterCode(renderer, ' 123456 ');
      await press(renderer, 'Verify and sign in');
      expect(clerkMocks.create).toHaveBeenCalledOnce();
      expect(clerkMocks.attemptSecondFactor).toHaveBeenCalledWith({ strategy: 'email_code', code: '123456' });
      expect(clerkMocks.setActive).toHaveBeenCalledWith({ session: 'session_existing' });
      expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
    } finally { await act(async () => renderer.unmount()); }
  });

  it('keeps failed codes on the challenge and supports resend without another password attempt', async () => {
    const renderer = await renderPasswordSignIn({ status: 'needs_second_factor', supportedSecondFactors: [emailFactor] });
    try {
      clerkMocks.attemptSecondFactor.mockRejectedValue(new Error('invalid code'));
      await enterCode(renderer, '000000');
      await press(renderer, 'Verify and sign in');
      expect(renderedText(renderer)).toContain('Could not verify the code');
      expect(clerkMocks.setActive).not.toHaveBeenCalled();
      await press(renderer, 'Send a new code');
      expect(clerkMocks.prepareSecondFactor).toHaveBeenCalledTimes(2);
      expect(clerkMocks.create).toHaveBeenCalledOnce();
      expect(renderer.container.queryAll((node) => node.type === 'TextInput')[0].props.value).toBe('');
    } finally { await act(async () => renderer.unmount()); }
  });

  it('lets a failed initial delivery be retried', async () => {
    clerkMocks.prepareSecondFactor.mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderPasswordSignIn({ status: 'needs_second_factor', supportedSecondFactors: [emailFactor] });
    try {
      expect(renderedText(renderer)).toContain('Could not send the code');
      expect(renderer.container.queryAll((node) => node.type === 'TextInput')[0].props.editable).toBe(false);
      await press(renderer, 'Send code');
      expect(renderer.container.queryAll((node) => node.type === 'TextInput')[0].props.editable).toBe(true);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('supports authenticator and offered backup codes without sending a message', async () => {
    const renderer = await renderPasswordSignIn({ status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'totp' }, { strategy: 'backup_code' }] });
    try {
      expect(renderedText(renderer)).toContain('authenticator app');
      expect(clerkMocks.prepareSecondFactor).not.toHaveBeenCalled();
      await press(renderer, 'Use a backup code');
      await enterCode(renderer, 'backup-code');
      clerkMocks.attemptSecondFactor.mockResolvedValue({ status: 'complete', createdSessionId: 'session_existing' });
      clerkMocks.navigate.mockReturnValue(false);
      await press(renderer, 'Verify and sign in');
      expect(clerkMocks.attemptSecondFactor).toHaveBeenCalledWith({ strategy: 'backup_code', code: 'backup-code' });
      expect(clerkMocks.setActive).toHaveBeenCalledWith({ session: 'session_existing' });
      expect(routerMocks.replace).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); }
  });

  it('prepares SMS only for the phone offered by Clerk and does not activate incomplete verification', async () => {
    const renderer = await renderPasswordSignIn({ status: 'needs_client_trust', supportedSecondFactors: [{ strategy: 'phone_code', phoneNumberId: 'phone_existing', safeIdentifier: '***1234' }] });
    try {
      expect(clerkMocks.prepareSecondFactor).toHaveBeenCalledWith({ strategy: 'phone_code', phoneNumberId: 'phone_existing' });
      clerkMocks.attemptSecondFactor.mockResolvedValue({ status: 'needs_second_factor' });
      await enterCode(renderer, '123456');
      await press(renderer, 'Verify and sign in');
      expect(clerkMocks.setActive).not.toHaveBeenCalled();
      expect(renderedText(renderer)).toContain('Verification is not complete');
    } finally { await act(async () => renderer.unmount()); }
  });

  it('does not bypass an unsupported challenge', async () => {
    const renderer = await renderPasswordSignIn({ status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'email_link' }] });
    try {
      expect(renderedText(renderer)).toContain('verification method that is not available here');
      expect(clerkMocks.setActive).not.toHaveBeenCalled();
      expect(clerkMocks.prepareSecondFactor).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); }
  });

});

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
const authMocks = vi.hoisted(() => ({
  beginRecovery: vi.fn(),
  completeRecovery: vi.fn(),
  isUnknownAccount: vi.fn((_error: unknown) => false),
  setActive: vi.fn(),
}));

function host(name: string) {
  return (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
}

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Linking: { openURL: vi.fn() },
  Platform: { OS: 'ios' },
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  TouchableOpacity: host('TouchableOpacity'),
  View: host('NativeView'),
}));
vi.mock('@clerk/expo/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    setActive: authMocks.setActive,
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
  beginExistingAccountPasswordRecovery: authMocks.beginRecovery,
  completeExistingAccountPasswordRecovery: authMocks.completeRecovery,
  isUnknownRecoveryAccountError: authMocks.isUnknownAccount,
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
    authMocks.beginRecovery.mockReset();
    authMocks.beginRecovery.mockResolvedValue(undefined);
    authMocks.completeRecovery.mockReset();
    authMocks.completeRecovery.mockResolvedValue({
      status: 'complete',
      sessionId: 'sess_existing_owner',
    });
    authMocks.isUnknownAccount.mockReset();
    authMocks.isUnknownAccount.mockReturnValue(false);
    authMocks.setActive.mockReset();
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

  it.each(screens)('uses one clear restore-library experience for the %s route', async (_name, Screen) => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(Screen)));
      const copy = renderer.container.queryAll((instance) => instance.type === 'Text')
        .flatMap((instance) => instance.props.children ?? [])
        .filter((value): value is string => typeof value === 'string')
        .join(' ');

      expect(copy).toContain('Restore my library');
      expect(copy).toContain('never creates a second library');
      expect(copy).toContain('Used Hide My Email?');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('sets a durable password before activating the restored account', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecoverAccountScreen)));
      const emailInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'you@example.com',
      )[0];
      await act(async () => emailInput.props.onChangeText(' Chef@Example.com '));
      const continueButton = renderer.container.queryAll(
        (instance) => instance.type === 'Button' && instance.props.title === 'Continue securely',
      )[0];
      await act(async () => continueButton.props.onPress());

      expect(authMocks.beginRecovery).toHaveBeenCalledWith(
        expect.anything(),
        ' Chef@Example.com ',
      );
      const codeInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === '6-digit code',
      )[0];
      const passwordInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'At least 8 characters',
      )[0];
      const confirmInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'Enter it again',
      )[0];
      await act(async () => {
        codeInput.props.onChangeText('123456');
        passwordInput.props.onChangeText('durable-password');
        confirmInput.props.onChangeText('durable-password');
      });
      const restoreButton = renderer.container.queryAll(
        (instance) => instance.type === 'Button' && instance.props.title === 'Restore my recipes',
      )[0];
      await act(async () => restoreButton.props.onPress());

      expect(authMocks.completeRecovery).toHaveBeenCalledWith(
        expect.anything(),
        '123456',
        'durable-password',
      );
      expect(authMocks.setActive).toHaveBeenCalledWith({ session: 'sess_existing_owner' });
      expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('does not reveal whether an entered email belongs to an account', async () => {
    const lookupError = new Error('unknown account');
    authMocks.beginRecovery.mockRejectedValueOnce(lookupError);
    authMocks.isUnknownAccount.mockImplementation((error) => error === lookupError);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecoverAccountScreen)));
      const emailInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'you@example.com',
      )[0];
      await act(async () => emailInput.props.onChangeText('unknown@example.com'));
      const continueButton = renderer.container.queryAll(
        (instance) => instance.type === 'Button' && instance.props.title === 'Continue securely',
      )[0];
      await act(async () => continueButton.props.onPress());

      const copy = renderer.container.queryAll((instance) => instance.type === 'Text')
        .flatMap((instance) => instance.props.children ?? [])
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
      expect(copy).toContain('If a Håfa account matches this email');
      expect(copy).not.toContain('No account found');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === '6-digit code',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('discards verification and password input before changing the recovery email', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(React.createElement(RecoverAccountScreen)));
      const emailInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'you@example.com',
      )[0];
      await act(async () => emailInput.props.onChangeText('first@example.com'));
      const continueButton = renderer.container.queryAll(
        (instance) => instance.type === 'Button' && instance.props.title === 'Continue securely',
      )[0];
      await act(async () => continueButton.props.onPress());

      const codeInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === '6-digit code',
      )[0];
      const passwordInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'At least 8 characters',
      )[0];
      const confirmInput = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'Enter it again',
      )[0];
      await act(async () => {
        codeInput.props.onChangeText('123456');
        passwordInput.props.onChangeText('discard-me');
        confirmInput.props.onChangeText('discard-me');
      });

      const changeButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Change recovery email',
      )[0];
      await act(async () => changeButton.props.onPress());
      await act(async () => emailInput.props.onChangeText('second@example.com'));
      const secondContinueButton = renderer.container.queryAll(
        (instance) => instance.type === 'Button' && instance.props.title === 'Continue securely',
      )[0];
      await act(async () => secondContinueButton.props.onPress());

      const secureInputs = renderer.container.queryAll((instance) => instance.type === 'Input');
      expect(secureInputs.find((instance) => instance.props.placeholder === '6-digit code')?.props.value)
        .toBe('');
      expect(secureInputs.find((instance) => instance.props.placeholder === 'At least 8 characters')?.props.value)
        .toBe('');
      expect(secureInputs.find((instance) => instance.props.placeholder === 'Enter it again')?.props.value)
        .toBe('');
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

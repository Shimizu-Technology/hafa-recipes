import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  onboarding: { status: 'idle' as const },
  rememberOwner: vi.fn(),
  updatePassword: vi.fn(),
}));

function host(name: string) {
  return (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);
}

vi.mock('react-native', () => ({
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: vi.fn() },
  StyleSheet: { create: <T,>(styles: T) => styles },
  TouchableOpacity: host('TouchableOpacity'),
  View: host('NativeView'),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Ionicons') }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({
    getToken: vi.fn(),
    isLoaded: true,
    isSignedIn: true,
    sessionId: 'sess_recovered_owner',
    userId: 'user_recovered_owner',
  }),
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({
    isLoaded: true,
    user: {
      createExternalAccount: vi.fn(),
      externalAccounts: [],
      passwordEnabled: false,
      reload: vi.fn(),
      updatePassword: mocks.updatePassword,
    },
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    error: null,
    isError: false,
    isPending: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock('@/components/BrandMark', () => ({ BrandMark: host('BrandMark') }));
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
    textSecondary: '#444',
    tint: '#176b5b',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { bold: 'bold', display: 'display', medium: 'medium' },
  fontSize: { xs: 10, sm: 12, md: 14, xxl: 24 },
  radius: { full: 999, xl: 20 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
}));
vi.mock('@/hooks/useRecipes', () => ({ recipeKeys: { count: () => ['recipes', 'count'] } }));
vi.mock('@/lib/accountAccess', () => ({
  canUseVerifiedAccountOffline: () => false,
  classifyAccountAccessError: () => null,
  clerkErrorMessage: (_error: unknown, fallback: string) => fallback,
  hasDurableSignInMethod: (user: { passwordEnabled?: boolean } | null) =>
    Boolean(user?.passwordEnabled),
}));
vi.mock('@/lib/accountOnboarding', () => ({
  beginAccountOnboarding: vi.fn(),
  clearAccountOnboarding: vi.fn(),
  clearVerifiedAccountOwner: vi.fn(),
  failAccountOnboarding: vi.fn(),
  getAccountOnboardingState: () => mocks.onboarding,
  hasVerifiedAccountOwner: vi.fn().mockResolvedValue(false),
  rememberVerifiedAccountOwner: mocks.rememberOwner,
  restoreAccountOnboarding: vi.fn().mockResolvedValue(undefined),
  subscribeToAccountOnboarding: () => () => undefined,
}));
vi.mock('@/lib/api', () => ({ api: { getRecipeCount: vi.fn(), setTokenGetter: vi.fn() } }));
vi.mock('@/lib/clerkMigration', () => ({
  CLERK_ENVIRONMENT: 'production',
  getOrCreateInstallationId: vi.fn(),
  markMigrationSignedOut: vi.fn(),
  onboardProductionAccount: vi.fn(),
}));
vi.mock('@/lib/groceryWidget', () => ({ clearGroceryWidgetSession: vi.fn() }));
vi.mock('@/lib/offlineStorage', () => ({ clearAllOfflineGroceryData: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/socialAuthentication', () => ({
  inspectOAuthCallback: vi.fn(),
  MOBILE_OAUTH_CALLBACK_URL: 'hafarecipes://oauth-callback',
}));

import { AccountAccessGate } from './AccountAccessGate';

describe('AccountAccessGate recovery security step', () => {
  beforeEach(() => {
    mocks.rememberOwner.mockReset();
    mocks.rememberOwner.mockResolvedValue(undefined);
    mocks.updatePassword.mockReset();
    mocks.updatePassword.mockResolvedValue({ passwordEnabled: true });
  });

  it('creates a durable password on the recovered account before opening its recipes', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(
          AccountAccessGate,
          null,
          React.createElement('PrivateRecipes'),
        ));
        await Promise.resolve();
        await Promise.resolve();
      });

      const password = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'At least 8 characters',
      )[0];
      const confirmation = renderer.container.queryAll(
        (instance) => instance.type === 'Input' && instance.props.placeholder === 'Enter it again',
      )[0];
      await act(async () => {
        password.props.onChangeText('durable-password');
        confirmation.props.onChangeText('durable-password');
      });

      const save = renderer.container.queryAll(
        (instance) => instance.type === 'Button' &&
          instance.props.title === 'Save password and open my recipes',
      )[0];
      await act(async () => save.props.onPress());

      expect(mocks.updatePassword).toHaveBeenCalledWith({
        newPassword: 'durable-password',
        signOutOfOtherSessions: false,
      });
      expect(mocks.rememberOwner).toHaveBeenCalledWith(
        'sess_recovered_owner',
        'user_recovered_owner',
      );
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'PrivateRecipes',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

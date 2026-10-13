// @ts-ignore -- Node types are not part of the app tsconfig; this runs only under Vitest.
import Module from 'node:module';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  setThemePreference: vi.fn(),
  setTextSize: vi.fn(),
  refetchCount: vi.fn(),
  countError: false,
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Linking: { openURL: vi.fn() },
    Modal: host('Modal'),
    Platform: { OS: 'ios' },
    ScrollView: host('ScrollView'),
    Share: { share: vi.fn() },
    StyleSheet: { create: <T,>(styles: T) => styles },
    TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: true, isLoaded: true, sessionId: 'sess-1' }),
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: { firstName: 'Leon', lastName: 'S', update: vi.fn() } }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '2.6.11' } } }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Card: host('Card'),
    Divider: () => null,
    SectionHeader: ({ title }: { title: string }) => ReactModule.createElement('SectionHeader', null, title),
    Text: host('ThemedText'),
    View: host('ThemedView'),
    useColors: () => ({
      background: '#fff',
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      card: '#fff',
      error: '#b42318',
      text: '#111',
      textMuted: '#666',
      textSecondary: '#555',
      tint: '#155c52',
    }),
  };
});
vi.mock('@/components/BrandMark', () => ({ BrandMark: () => null }));
vi.mock('@/components/SettingsProfileCard', () => ({ SettingsProfileCard: () => null }));
vi.mock('@/hooks/useRecipes', () => ({
  useRecipeCount: () => ({
    data: mocks.countError ? undefined : { count: 7 },
    isError: mocks.countError,
    refetch: mocks.refetchCount,
  }),
}));
vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.example.test', api: {} }));
vi.mock('@/lib/sentry', () => ({ captureMessage: vi.fn(), captureError: vi.fn() }));
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ themePreference: 'dark', setThemePreference: mocks.setThemePreference }),
}));
vi.mock('@/lib/offlineStorage', () => ({ clearAllOfflineGroceryData: vi.fn() }));
vi.mock('@/lib/chatDrafts', () => ({ clearAccountChatStorage: vi.fn() }));
vi.mock('@/lib/clerkMigration', () => ({ CLERK_ENVIRONMENT: 'production', markMigrationSignedOut: vi.fn() }));
vi.mock('@/lib/groceryWidget', () => ({ clearGroceryWidgetSession: vi.fn() }));
vi.mock('@/lib/accountAccess', () => ({ hasDurableSignInMethod: () => true }));
vi.mock('@/lib/accountOnboarding', () => ({ clearAccountOnboarding: vi.fn(), clearVerifiedAccountOwner: vi.fn() }));
vi.mock('@/hooks/useTimerSound', () => ({
  TIMER_SOUNDS: [
    { id: 'default', label: 'Default', description: 'Pleasant notification sound' },
    { id: 'bell', label: 'Bell', description: 'Simple bell ring' },
    { id: 'none', label: 'None', description: 'Vibration only (no sound)' },
  ],
  playTimerSoundPreview: vi.fn(),
  useTimerSoundPreference: () => ({ soundPreference: 'bell', setTimerSound: vi.fn() }),
}));
vi.mock('@/hooks/useTTS', () => ({
  TTS_VOICES: [
    { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced' },
    { id: 'echo', name: 'Echo', description: 'Soft, gentle' },
  ],
  useTTSVoice: () => ({ voice: 'alloy', setVoice: vi.fn() }),
}));
vi.mock('@/hooks/useTextSize', () => ({
  TEXT_SIZE_LABELS: { small: 'Small', medium: 'Medium', large: 'Large', 'extra-large': 'Extra Large' },
  useTextSize: () => ({ textSize: 'large', setTextSize: mocks.setTextSize }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 11, sm: 13, md: 15, lg: 18, xl: 20, xxl: 24, xxxl: 30 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { sm: 4, md: 14, lg: 20, xl: 28, full: 9999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/lib/appVersion', () => ({ resolveAppVersion: (version?: string) => version ?? '0.0.0' }));
vi.mock('@/lib/settingsProfile', () => ({ resolveSettingsProfileName: () => 'Leon S' }));

import SettingsScreen from '../app/settings';

function textOf(node: ReactTestInstance | string | number): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node.children.map(textOf).join('');
}

function touchables(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType);
}

function byLabel(renderer: ReactTestRenderer, label: string) {
  return touchables(renderer).find((node) => node.props.accessibilityLabel === label);
}

async function renderSettings() {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SettingsScreen />);
  });
  return renderer!;
}

// settings.tsx lazily `require`s '@/lib/api' inside the component, which
// bypasses vi.mock; route that one CommonJS request to the same stub.
type ModuleLoader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as ModuleLoader;
const originalLoad = loader._load;

describe('SettingsScreen accessibility', () => {
  beforeAll(() => {
    loader._load = (request, ...rest) => (
      request === '@/lib/api' ? { API_BASE_URL: 'https://api.example.test', api: {} } : originalLoad(request, ...rest)
    );
  });
  afterAll(() => {
    loader._load = originalLoad;
  });

  beforeEach(() => {
    mocks.countError = false;
    mocks.setThemePreference.mockClear();
    mocks.setTextSize.mockClear();
    mocks.refetchCount.mockClear();
  });

  it('labels the theme segments and marks only the active theme selected', async () => {
    const renderer = await renderSettings();

    const expected = { 'Automatic theme': 'system', 'Light theme': 'light', 'Dark theme': 'dark' } as const;
    for (const [label, key] of Object.entries(expected)) {
      const option = byLabel(renderer, label)!;
      expect(option.props.accessibilityRole, label).toBe('button');
      expect(option.props.accessibilityState, label).toEqual({ selected: key === 'dark' });
    }

    await act(async () => byLabel(renderer, 'Light theme')!.props.onPress());
    expect(mocks.setThemePreference).toHaveBeenCalledWith('light');
  });

  it('labels the abbreviated text size segments and marks only the active size selected', async () => {
    const renderer = await renderSettings();

    const expected = {
      'Text size small': 'small',
      'Text size medium': 'medium',
      'Text size large': 'large',
      'Text size extra large': 'extra-large',
    } as const;
    for (const [label, key] of Object.entries(expected)) {
      const option = byLabel(renderer, label)!;
      expect(option.props.accessibilityRole, label).toBe('button');
      expect(option.props.accessibilityState, label).toEqual({ selected: key === 'large' });
    }

    await act(async () => byLabel(renderer, 'Text size extra large')!.props.onPress());
    expect(mocks.setTextSize).toHaveBeenCalledWith('extra-large');
  });

  it('exposes the timer sound picker options with their selected state', async () => {
    const renderer = await renderSettings();

    const options = ['Default', 'Bell', 'None'].map((label) => touchables(renderer)
      .find((node) => node.props.accessibilityState && 'selected' in node.props.accessibilityState
        && textOf(node).startsWith(label))!);
    expect(options.map((option) => option.props.accessibilityRole)).toEqual(['button', 'button', 'button']);
    expect(options.map((option) => option.props.accessibilityState.selected)).toEqual([false, true, false]);
  });

  it('reports the developer tools disclosure as expanded or collapsed', async () => {
    const renderer = await renderSettings();
    const toggle = () => touchables(renderer).find((node) => /Developer Tools$/.test(textOf(node)))!;

    expect(toggle().props.accessibilityRole).toBe('button');
    expect(toggle().props.accessibilityState).toEqual({ expanded: false });
    await act(async () => toggle().props.onPress());
    expect(toggle().props.accessibilityState).toEqual({ expanded: true });
  });

  it('labels the recipe count retry action when the count fails to load', async () => {
    mocks.countError = true;
    const renderer = await renderSettings();

    const retry = byLabel(renderer, 'Try loading your recipe count again')!;
    expect(retry.props.accessibilityRole).toBe('button');
    await act(async () => retry.props.onPress());
    expect(mocks.refetchCount).toHaveBeenCalledOnce();
  });

  it('labels the profile save action', async () => {
    const renderer = await renderSettings();

    const save = byLabel(renderer, 'Save profile')!;
    expect(save.props.accessibilityRole).toBe('button');
    expect(save.props.accessibilityState).toEqual({ disabled: false, busy: false });
  });
});

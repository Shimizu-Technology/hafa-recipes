import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ isSignedIn: false }));

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));
vi.mock('expo-router', async () => {
  const ReactModule = await import('react');
  const Tabs = Object.assign(
    ({ children, screenOptions }: { children: React.ReactNode; screenOptions: unknown }) =>
      ReactModule.createElement('Tabs', { screenOptions }, children),
    { Screen: ({ name }: { name: string }) => ReactModule.createElement('TabScreen', { name }) },
  );
  return { Tabs };
});
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: mocks.isSignedIn, isLoaded: false, userId: null }),
}));
vi.mock('@/constants/Colors', () => ({
  default: {
    light: { tint: '#155C52', tabIconDefault: '#666', backgroundElevated: '#fff', border: '#ddd', background: '#fff' },
  },
}));
vi.mock('@/components/useColorScheme', () => ({ useColorScheme: () => 'light' }));
vi.mock('@/components/TabChrome', () => ({
  AccountHeaderButton: 'AccountHeaderButton',
  ImportTabIcon: 'ImportTabIcon',
  TabHeaderBrand: 'TabHeaderBrand',
}));
vi.mock('@/components/AssistantHeaderButton', () => ({ AssistantHeaderButton: 'AssistantHeaderButton' }));
vi.mock('@/lib/tabPrefetch', () => ({ prefetchTabData: vi.fn() }));

import TabLayout from '@/app/(tabs)/_layout';

describe('main tab header assistant', () => {
  it.each([
    { isSignedIn: false, expectedAssistantCount: 0 },
    { isSignedIn: true, expectedAssistantCount: 1 },
  ])('shows cooking help only for signed-in users', async ({ isSignedIn, expectedAssistantCount }) => {
    mocks.isSignedIn = isSignedIn;
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(<TabLayout />));
      const tabs = renderer.container.queryAll((instance) => instance.type === 'Tabs')[0];
      await act(async () => renderer.render(tabs.props.screenOptions.headerRight()));

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'AssistantHeaderButton',
      )).toHaveLength(expectedAssistantCount);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'AccountHeaderButton',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

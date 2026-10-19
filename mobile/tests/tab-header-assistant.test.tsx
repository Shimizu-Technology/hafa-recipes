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
    ({ children, screenOptions, tabBar }: { children: React.ReactNode; screenOptions: unknown; tabBar: unknown }) =>
      ReactModule.createElement('Tabs', { screenOptions, tabBar }, children),
    {
      Screen: ({ name, options }: { name: string; options?: Record<string, unknown> }) =>
        ReactModule.createElement('TabScreen', { name, options }),
    },
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
    light: { tint: '#155C52', tabIconDefault: '#666', backgroundElevated: '#fff', border: '#ddd', background: '#fff', text: '#111' },
  },
  fontFamily: { semibold: 'DMSans_600SemiBold' },
  fontSize: { lg: 17 },
}));
vi.mock('@/components/useColorScheme', () => ({ useColorScheme: () => 'light' }));
vi.mock('@/components/TabChrome', () => ({
  AccountHeaderButton: 'AccountHeaderButton',
  ImportTabIcon: 'ImportTabIcon',
  TabHeaderBrand: 'TabHeaderBrand',
}));
vi.mock('@/components/AssistantTabBar', () => ({ AssistantTabBar: 'AssistantTabBar' }));
vi.mock('@/lib/tabPrefetch', () => ({ prefetchTabData: vi.fn() }));

import TabLayout from '@/app/(tabs)/_layout';

describe('main tab assistant dock', () => {
  it.each([
    { isSignedIn: false, expectedAssistantCount: 0 },
    { isSignedIn: true, expectedAssistantCount: 1 },
  ])('shows cooking help only for signed-in users', async ({ isSignedIn, expectedAssistantCount }) => {
    mocks.isSignedIn = isSignedIn;
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(<TabLayout />));
      const tabs = renderer.container.queryAll((instance) => instance.type === 'Tabs')[0];
      await act(async () => renderer.render(tabs.props.tabBar({})));

      expect(renderer.container.queryAll((instance) => instance.type === 'AssistantTabBar')[0]
        .props.isSignedIn).toBe(Boolean(expectedAssistantCount));
      await act(async () => renderer.render(tabs.props.screenOptions.headerRight()));
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'AccountHeaderButton',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps the brand on Discover and names every other tab in its header', async () => {
    mocks.isSignedIn = true;
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(<TabLayout />));
      const tabs = renderer.container.queryAll((instance) => instance.type === 'Tabs')[0];
      const screens = renderer.container.queryAll((instance) => instance.type === 'TabScreen');
      const byName = Object.fromEntries(screens.map((screen) => [screen.props.name, screen.props.options]));

      expect(tabs.props.screenOptions.headerTitle).toBeUndefined();
      expect(tabs.props.screenOptions.headerTitleStyle.fontFamily).toBe('DMSans_600SemiBold');
      expect(typeof byName.discover.headerTitle).toBe('function');
      expect(screens.map((screen) => screen.props.options.title))
        .toEqual(['Discover', 'Library', 'Import', 'Plan', 'Grocery']);
      for (const name of ['history', 'index', 'planner', 'grocery']) {
        expect(byName[name].headerTitle).toBeUndefined();
      }
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

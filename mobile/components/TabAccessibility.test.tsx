import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ isSignedIn: false }));

vi.mock('@/components/Animated', () => ({ ScalePressable: 'ScalePressable' }));
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

describe('four-tab chrome', () => {
  it('keeps four visible workflows, the brand and account settings', async () => {
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(<TabLayout />));
      const tabs = renderer.container.queryAll((instance) => instance.type === 'Tabs')[0];
      const screens = renderer.container.queryAll((instance) => instance.type === 'TabScreen');
      const visible = screens.filter((screen) => screen.props.options.href !== null);
      expect(visible.map((screen) => screen.props.options.title)).toEqual(['Recipes', 'Add', 'Plan', 'Grocery']);
      expect(typeof visible[0].props.options.headerTitle).toBe('function');
      expect(tabs.props.tabBar).toBeUndefined();
      await act(async () => renderer.render(tabs.props.screenOptions.headerRight()));
      expect(renderer.container.queryAll((instance) => instance.type === 'AccountHeaderButton')).toHaveLength(1);
    } finally { await act(async () => renderer.unmount()); }
  });
});

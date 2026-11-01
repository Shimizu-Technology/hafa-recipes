import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const theme = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark', mounts: 0 }));
vi.mock('@/components/useColorScheme', () => ({ useColorScheme: () => theme.scheme }));
vi.mock('expo-router/unstable-native-tabs', () => {
  const Trigger = Object.assign(({ children, ...props }: any) => React.createElement('Trigger', props, children), { Label: 'Label', Icon: 'Icon', VectorIcon: 'VectorIcon' });
  return { NativeTabs: Object.assign(({ children, ...props }: any) => { React.useEffect(() => { theme.mounts++; }, []); return React.createElement('NativeTabs', props, children); }, { Trigger }) };
});
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: false }) }));
vi.mock('@/components/Themed', () => ({ useColors: () => ({ tint: theme.scheme === 'dark' ? '#5DD3B6' : '#1E7F6E' }) }));
vi.mock('@/lib/tabPrefetch', () => ({ prefetchTabData: vi.fn() }));
import TabLayout from '@/app/(tabs)/_layout';
it('names five native tabs with SF Symbols and a platform search role', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<TabLayout />));
    const tabs = r.container.queryAll(n => n.type === 'Trigger');
    expect(tabs.map(n => n.props.name)).toEqual(['recipes', 'discover', 'planner', 'grocery', 'search']);
    expect(tabs[4].props.role).toBe('search');
    expect(r.container.queryAll(n => n.type === 'Label').map(n => n.props.children)).toEqual(['Library', 'Discover', 'Plan', 'Grocery', 'Search']);
    const icons = r.container.queryAll(n => n.type === 'Icon').map(n => n.props.sf);
    expect(icons.every(Boolean)).toBe(true);
    expect(icons[0]).toEqual({ default: 'books.vertical', selected: 'books.vertical.fill' });
    expect(icons[3]).toEqual({ default: 'cart', selected: 'cart.fill' });
    // iOS 18's full-width bar must keep its material over the photo grid.
    expect(r.container.queryAll(n => n.type === 'NativeTabs')[0].props.disableTransparentOnScrollEdge).toBe(true);
  } finally { await act(async () => r.unmount()); }
});

it('updates the mounted native host scheme and tint when Dark resolves back to Auto light', async () => {
  const r = createRoot(); const mounts = theme.mounts;
  try {
    for (const scheme of ['dark', 'light', 'dark'] as const) {
      theme.scheme = scheme;
      await act(async () => r.render(<TabLayout />));
      const host = r.container.queryAll(n => n.type === 'NativeTabs')[0];
      expect(host.props.unstable_nativeProps.colorScheme).toBe(scheme);
      expect(host.props.tintColor).toBe(scheme === 'dark' ? '#5DD3B6' : '#1E7F6E');
      expect(theme.mounts).toBe(mounts + 1);
    }
  } finally { await act(async () => r.unmount()); }
});

import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('expo-router/unstable-native-tabs', () => {
  const Trigger = Object.assign(({ children, ...props }: any) => React.createElement('Trigger', props, children), { Label: 'Label', Icon: 'Icon', VectorIcon: 'VectorIcon' });
  return { NativeTabs: Object.assign(({ children, ...props }: any) => React.createElement('NativeTabs', props, children), { Trigger }) };
});
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: false }) }));
vi.mock('@/components/Themed', () => ({ useColors: () => ({ tint: '#1E7F6E' }) }));
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
    expect(r.container.queryAll(n => n.type === 'Icon').every(n => n.props.sf)).toBe(true);
  } finally { await act(async () => r.unmount()); }
});

import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => nav }));
vi.mock('react-native', () => ({ ScrollView: 'ScrollView', View: 'View', Pressable: 'Pressable', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({}) }));
import AddRecipeOptions from '@/app/add-options';
it('offers four named capture entries and replaces the sheet with the existing flows', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<AddRecipeOptions />));
    const rows = r.container.queryAll(n => n.type === 'Pressable');
    expect(rows.map(n => n.props.accessibilityLabel)).toEqual(['Paste a link', 'Scan a cookbook page', 'Choose photos', 'Type it in']);
    for (const row of rows) await act(async () => row.props.onPress());
    expect(nav.replace.mock.calls.map(c => c[0])).toEqual(['/', '/?entry=scan', '/?entry=photos', '/add-recipe']);
    expect(r.container.queryAll(n => n.type === 'Text').some(n => n.props.children === 'Tip: share straight from TikTok, Instagram or Safari.')).toBe(true);
  } finally { await act(async () => r.unmount()); }
});

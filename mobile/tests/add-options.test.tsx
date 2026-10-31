import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ replace: vi.fn(), signedIn: true }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: nav.signedIn }) }));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: 'SignInBanner' }));
vi.mock('expo-router', () => ({ useRouter: () => nav }));
vi.mock('react-native', () => ({ ScrollView: 'ScrollView', View: 'View', Pressable: 'Pressable', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({}) }));
import AddRecipeOptions from '@/app/add-options';
beforeEach(() => { nav.signedIn = true; nav.replace.mockClear(); });
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

it('explains guest capture restrictions and keeps all choices available after sign-in', async () => {
  nav.signedIn = false;
  const r = createRoot();
  try {
    await act(async () => r.render(<AddRecipeOptions />));
    expect(r.container.queryAll(n => n.type === 'SignInBanner')[0].props.message).toBe('Sign in to add a recipe');
    const rows = r.container.queryAll(n => n.type === 'Pressable');
    expect(rows).toHaveLength(4);
    for (const row of rows) { expect(row.props.accessibilityState.disabled).toBe(true); expect(row.props.onPress).toBeUndefined(); }
    expect(nav.replace).not.toHaveBeenCalled();
    nav.signedIn = true;
    await act(async () => r.render(<AddRecipeOptions />));
    expect(r.container.queryAll(n => n.type === 'SignInBanner')).toHaveLength(0);
    const manual = r.container.queryAll(n => n.props.accessibilityLabel === 'Type it in')[0];
    expect(manual.props.accessibilityState.disabled).toBe(false);
    await act(async () => manual.props.onPress());
    expect(nav.replace).toHaveBeenCalledWith('/add-recipe');
  } finally { await act(async () => r.unmount()); }
});

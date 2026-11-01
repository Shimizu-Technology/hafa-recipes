import React, { act, useSyncExternalStore } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  system: 'light', override: 'unspecified', listeners: new Set<() => void>(),
  get: vi.fn(), set: vi.fn(), native: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Appearance: { setColorScheme: (value: string) => {
    state.native(value); state.override = value; state.listeners.forEach(listener => listener());
  } },
  useColorScheme: () => useSyncExternalStore(listener => {
    state.listeners.add(listener); return () => { state.listeners.delete(listener); };
  }, () => state.override === 'unspecified' ? state.system : state.override),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: state.get, setItem: state.set } }));
import { ThemeProvider, useTheme } from './ThemeContext';
import { useColors } from '@/components/Themed';
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
vi.mock('@/components/Animated', () => ({ ScalePressable: 'Pressable' }));

let theme: ReturnType<typeof useTheme>;
function MountedScreen() {
  theme = useTheme();
  const colors = useColors();
  return React.createElement('paint', { scheme: theme.colorScheme, text: colors.text });
}
const systemChange = (scheme: string) => {
  state.system = scheme; state.listeners.forEach(listener => listener());
};
describe('live native and JS appearance', () => {
  beforeEach(() => { state.override = 'unspecified'; state.system = 'light'; state.get.mockResolvedValue(null); state.set.mockResolvedValue(undefined); state.native.mockClear(); });
  it('maps Light → Dark → Auto to UIKit and repaints the same mounted consumer on system changes', async () => {
    const r = createRoot();
    await act(async () => r.render(<ThemeProvider><MountedScreen /></ThemeProvider>));
    for (const [preference, native, scheme, text] of [
      ['light', 'light', 'light', '#000000'], ['dark', 'dark', 'dark', '#FFFFFF'],
      ['system', 'unspecified', 'light', '#000000'],
    ] as const) {
      await act(async () => theme.setThemePreference(preference));
      expect(state.native).toHaveBeenLastCalledWith(native);
      expect(r.container.queryAll(n => n.type === 'paint')[0].props).toMatchObject({ scheme, text });
    }
    await act(async () => systemChange('dark'));
    expect(r.container.queryAll(n => n.type === 'paint')[0].props).toMatchObject({ scheme: 'dark', text: '#FFFFFF' });
    await act(async () => systemChange('light'));
    expect(theme.colorScheme).toBe('light');
    await act(async () => theme.setThemePreference('dark'));
    await act(async () => systemChange('light'));
    expect(theme.colorScheme).toBe('dark');
    await act(async () => r.unmount());
  });
  it.each(['light', 'dark'] as const)('restores the saved %s preference to native appearance', async saved => {
    state.get.mockResolvedValue(saved); const r = createRoot();
    await act(async () => r.render(<ThemeProvider><MountedScreen /></ThemeProvider>));
    expect(state.native).toHaveBeenLastCalledWith(saved); expect(theme.colorScheme).toBe(saved);
    await act(async () => r.unmount());
  });
});

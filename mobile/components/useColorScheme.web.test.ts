import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Appearance: { setColorScheme: vi.fn() }, useColorScheme: () => 'dark' }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) },
}));

import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { useColorScheme } from './useColorScheme.web';

it('follows the mounted ThemeProvider preference on web, starting from the system scheme', async () => {
  const seen: string[] = [];
  let setPreference: ((value: 'light' | 'dark' | 'system') => void) | undefined;
  function Consumer() {
    seen.push(useColorScheme());
    setPreference = useTheme().setThemePreference;
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  await act(async () => { renderer = create(createElement(ThemeProvider, null, createElement(Consumer))); });
  expect(seen.at(-1)).toBe('dark');
  await act(async () => { setPreference!('light'); });
  expect(seen.at(-1)).toBe('light');
  await act(async () => { setPreference!('system'); });
  expect(seen.at(-1)).toBe('dark');
  await act(async () => renderer!.unmount());
});

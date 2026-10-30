import { expect, it, vi } from 'vitest';

const theme = vi.hoisted(() => ({ current: 'dark' as 'dark' | 'light' }));
vi.mock('@/contexts/ThemeContext', () => ({ useColorScheme: () => theme.current }));

import { useColorScheme } from './useColorScheme.web';

it('uses the resolved theme preference on web and follows changes', () => {
  expect(useColorScheme()).toBe('dark');
  theme.current = 'light';
  expect(useColorScheme()).toBe('light');
});

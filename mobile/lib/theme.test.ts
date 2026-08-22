import { describe, expect, it } from 'vitest';

import { normalizeColorScheme } from './theme';

describe('normalizeColorScheme', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['unspecified', 'light'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(normalizeColorScheme(input)).toBe(expected);
  });
});

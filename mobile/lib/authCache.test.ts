import { describe, expect, it } from 'vitest';

import { shouldClearPrivateQueryCache } from './authCache';

describe('private query cache isolation', () => {
  it('does not clear before Clerk produces its first loaded identity', () => {
    expect(shouldClearPrivateQueryCache(undefined, null)).toBe(false);
    expect(shouldClearPrivateQueryCache(undefined, 'user-a')).toBe(false);
  });

  it('clears on sign-out, sign-in, and direct account changes', () => {
    expect(shouldClearPrivateQueryCache('user-a', null)).toBe(true);
    expect(shouldClearPrivateQueryCache(null, 'user-b')).toBe(true);
    expect(shouldClearPrivateQueryCache('user-a', 'user-b')).toBe(true);
  });

  it('keeps the cache when the loaded identity is unchanged', () => {
    expect(shouldClearPrivateQueryCache(null, null)).toBe(false);
    expect(shouldClearPrivateQueryCache('user-a', 'user-a')).toBe(false);
  });
});

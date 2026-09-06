import { describe, expect, it, vi } from 'vitest';

import { leaveAuthScreen } from './authNavigation';

describe('leaveAuthScreen', () => {
  it('returns through navigation history when one exists', () => {
    const router = {
      back: vi.fn(),
      canGoBack: vi.fn(() => true),
      replace: vi.fn(),
    };

    leaveAuthScreen(router);

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('returns to the primary tabs when a restored auth screen has no history', () => {
    const router = {
      back: vi.fn(),
      canGoBack: vi.fn(() => false),
      replace: vi.fn(),
    };

    leaveAuthScreen(router);

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });
});

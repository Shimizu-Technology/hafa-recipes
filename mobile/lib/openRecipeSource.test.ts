import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn(),
}));

vi.mock('react-native', () => ({
  Alert: { alert: native.alert },
  Linking: { openURL: native.openURL },
}));

import { openRecipeSource } from './openRecipeSource';

beforeEach(() => {
  native.alert.mockReset();
  native.openURL.mockReset();
});

describe('openRecipeSource', () => {
  it('opens the exact attached source', async () => {
    native.openURL.mockResolvedValue(undefined);

    await expect(openRecipeSource('https://www.instagram.com/reel/Example_42/')).resolves.toBe(true);
    expect(native.openURL).toHaveBeenCalledWith('https://www.instagram.com/reel/Example_42/');
    expect(native.alert).not.toHaveBeenCalled();
  });

  it('turns a rejected external handoff into a useful alert', async () => {
    native.openURL.mockRejectedValue(new Error('No handler'));

    await expect(openRecipeSource('https://www.instagram.com/reel/Example_42/')).resolves.toBe(false);
    expect(native.alert).toHaveBeenCalledWith(
      'Couldn’t open original',
      'Please try again. The original source is still attached to this recipe.',
    );
  });
});

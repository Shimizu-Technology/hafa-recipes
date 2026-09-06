import { describe, expect, it, vi } from 'vitest';

import { resolveSourcePlaybackMode } from './sourcePlaybackConfig';

describe('source playback release policy', () => {
  it('preserves embedded playback when the rollout flag is omitted', () => {
    expect(resolveSourcePlaybackMode(undefined)).toBe('embedded');
    expect(resolveSourcePlaybackMode('  ')).toBe('embedded');
  });

  it('supports an external-only rollback without hiding the source', () => {
    expect(resolveSourcePlaybackMode('external')).toBe('external');
    expect(resolveSourcePlaybackMode(' EMBEDDED ')).toBe('embedded');
  });

  it('fails closed with a diagnostic when the release value is invalid', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveSourcePlaybackMode('enabled')).toBe('external');
    expect(warning).toHaveBeenCalledWith(
      'Invalid EXPO_PUBLIC_SOURCE_PLAYBACK_MODE; embedded source playback is disabled.',
    );

    warning.mockRestore();
  });
});

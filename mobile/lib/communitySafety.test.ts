import { describe, expect, it } from 'vitest';

import {
  canSubmitAppeal,
  canSubmitReport,
  formatSafetyItemTitle,
  getSafetyErrorMessage,
} from './communitySafety';

describe('community safety helpers', () => {
  it('requires useful context for other reports and appeals', () => {
    expect(canSubmitReport('spam', '')).toBe(true);
    expect(canSubmitReport('other', 'too short')).toBe(false);
    expect(canSubmitReport('other', 'This needs a closer look')).toBe(true);
    expect(canSubmitAppeal('too short')).toBe(false);
    expect(canSubmitAppeal('I corrected the issue')).toBe(true);
  });

  it('uses plain-language tracking labels without exposing target internals', () => {
    expect(formatSafetyItemTitle({ category: 'unsafe', target_type: 'recipe' } as any)).toBe('Recipe report');
    expect(formatSafetyItemTitle({ category: 'appeal', target_type: 'contributor' } as any)).toBe('Account appeal');
  });

  it('uses bounded API details and falls back for malformed errors', () => {
    expect(getSafetyErrorMessage({ response: { data: { detail: 'Report target not found' } } })).toBe(
      'Report target not found',
    );
    expect(getSafetyErrorMessage({ response: { data: { detail: { private: 'value' } } } })).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

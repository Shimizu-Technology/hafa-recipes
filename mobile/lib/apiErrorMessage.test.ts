import { describe, expect, it } from 'vitest';

import { getApiErrorMessage } from './apiErrorMessage';

describe('getApiErrorMessage', () => {
  it('prefers string response details', () => {
    expect(getApiErrorMessage(
      { response: { data: { detail: 'This source already has a draft.' } } },
      'Fallback',
    )).toBe('This source already has a draft.');
  });

  it('reads structured detail messages and preserves a safe fallback', () => {
    expect(getApiErrorMessage(
      { response: { data: { detail: { code: 'REVIEW_REQUIRED', message: 'Review it first.' } } } },
      'Fallback',
    )).toBe('Review it first.');
    expect(getApiErrorMessage({}, 'Fallback')).toBe('Fallback');
  });
});

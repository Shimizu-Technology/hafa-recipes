import { describe, expect, it } from 'vitest';

import { chatErrorMessage } from './chatErrors';

describe('chatErrorMessage', () => {
  it('distinguishes network, validation, throttling, auth, and server failures', () => {
    expect(chatErrorMessage({ code: 'ERR_NETWORK' })).toContain('offline');
    expect(chatErrorMessage({ code: 'ECONNABORTED' })).toContain('took too long');
    expect(chatErrorMessage({ response: { status: 401 } })).toContain('session expired');
    expect(chatErrorMessage({ response: { status: 413 } })).toContain('too large');
    expect(chatErrorMessage({ response: { status: 422, data: { detail: 'A useful detail' } } })).toBe('A useful detail');
    expect(chatErrorMessage({ response: { status: 429 } })).toContain('Too many');
    expect(chatErrorMessage({ response: { status: 503 } })).toContain('temporarily unavailable');
    expect(chatErrorMessage({ response: { status: 400 } })).toBe('Your message was not sent. Please try again.');
  });

  it('does not surface unbounded or structured server detail', () => {
    expect(chatErrorMessage({ response: { status: 422, data: { detail: { secret: true } } } })).not.toContain('secret');
    expect(chatErrorMessage({ response: { status: 422, data: { detail: 'x'.repeat(181) } } })).not.toContain('xxx');
  });
});

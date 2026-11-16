import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_REQUEST_TIMEOUT_MS, timeoutSignal } from './requestTimeout';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('request timeout', () => {
  it('aborts after 15 seconds', () => {
    const { signal } = timeoutSignal(LINK_REQUEST_TIMEOUT_MS);
    vi.advanceTimersByTime(LINK_REQUEST_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
  });

  it('follows the caller’s and the owner’s signals', () => {
    const caller = new AbortController();
    const owner = new AbortController();
    const first = timeoutSignal(LINK_REQUEST_TIMEOUT_MS, caller.signal, owner.signal);
    owner.abort();
    expect(first.signal.aborted).toBe(true);
    const already = new AbortController();
    already.abort();
    expect(timeoutSignal(LINK_REQUEST_TIMEOUT_MS, already.signal).signal.aborted).toBe(true);
  });

  it('stops the timer and listeners once the request settles', () => {
    const caller = new AbortController();
    const request = timeoutSignal(LINK_REQUEST_TIMEOUT_MS, caller.signal);
    request.done();
    vi.advanceTimersByTime(LINK_REQUEST_TIMEOUT_MS * 2);
    caller.abort();
    expect(request.signal.aborted).toBe(false);
  });
});

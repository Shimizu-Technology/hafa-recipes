import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ fetch: vi.fn(), listener: null as null | ((state: unknown) => void), unsubscribe: vi.fn() }));
vi.mock('@react-native-community/netinfo', () => ({ default: { fetch: async () => ({ isConnected: true, isInternetReachable: true, type: 'wifi' }), addEventListener: (listener: (state: unknown) => void) => { f.listener = listener; return f.unsubscribe; } } }));
vi.mock('@/lib/apiConfig', () => ({ API_BASE_URL: 'https://example.test' }));
import { useNetworkStatus } from './useNetworkStatus';
let view: ReactTestRenderer | undefined, status: ReturnType<typeof useNetworkStatus>;
function Probe() { status = useNetworkStatus(); return null; }
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); f.fetch.mockReset(); f.fetch.mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f.fetch); f.unsubscribe.mockReset(); });
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
it('returns the actual retry promise/result and marks an explicit failed check immediately', async () => {
  await act(async () => { view = create(<Probe />); }); await flush(); expect(status.isApiReachable).toBe(true);
  let resolve!: (value: { ok: boolean }) => void; f.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let result: boolean | undefined; const checking = status.recheckApiHealth().then(value => { result = value; }); await flush(); expect(result).toBeUndefined();
  await act(async () => { resolve({ ok: false }); await checking; }); expect(result).toBe(false); expect(status.isApiReachable).toBe(false);
  expect(vi.getTimerCount()).toBe(1); // Only periodic monitoring remains.
});
it('clears failed health-check timeouts and stops monitoring on unmount', async () => {
  f.fetch.mockRejectedValue(Error('Network down')); await act(async () => { view = create(<Probe />); }); await flush();
  await act(async () => { expect(await status.recheckApiHealth()).toBe(false); }); expect(vi.getTimerCount()).toBe(1);
  await act(async () => view!.unmount()); view = undefined; expect(f.unsubscribe).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('keeps a newer reconnect success when an older explicit retry later fails', async () => {
  await act(async () => { view = create(<Probe />); }); await flush();
  let resolve!: (value: { ok: boolean }) => void;
  f.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const olderRetry = status.recheckApiHealth(); await flush();
  await act(async () => f.listener!({ isConnected: false, isInternetReachable: false, type: 'none' }));
  await act(async () => f.listener!({ isConnected: true, isInternetReachable: true, type: 'wifi' }));
  await flush(); expect(status.isOnline).toBe(true);
  await act(async () => { resolve({ ok: false }); expect(await olderRetry).toBe(false); });
  expect(status.isApiReachable).toBe(true); expect(status.isOnline).toBe(true);
});
it('does not let a pending successful probe override a definite disconnect', async () => {
  await act(async () => { view = create(<Probe />); }); await flush();
  let resolve!: (value: { ok: boolean }) => void;
  f.fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const pending = status.recheckApiHealth(); await flush();
  await act(async () => f.listener!({ isConnected: false, isInternetReachable: false, type: 'none' }));
  await act(async () => { resolve({ ok: true }); expect(await pending).toBe(true); });
  expect(status.isApiReachable).toBe(false); expect(status.isOnline).toBe(false);
});
it('does not turn an unknown network event into a confirmed outage', async () => {
  await act(async () => { view = create(<Probe />); }); await flush();
  await act(async () => f.listener!({ isConnected: null, isInternetReachable: null, type: 'unknown' }));
  expect(status.isConnected).toBeNull(); expect(status.isApiReachable).toBe(true);
});
it('aborts an in-flight health check and clears its timer when unmounted', async () => {
  let signal!: AbortSignal;
  f.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal; signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true });
  }));
  await act(async () => { view = create(<Probe />); }); await flush(); expect(signal.aborted).toBe(false);
  await act(async () => view!.unmount()); view = undefined; expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

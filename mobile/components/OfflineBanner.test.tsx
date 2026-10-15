import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ isConnected: false as boolean | null, isApiReachable: false as boolean | null, isOnline: false, recheck: vi.fn() }));
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ ...f, recheckApiHealth: f.recheck }) }));
vi.mock('react-native', () => ({ Text: 'Text', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
import { OfflineBanner } from './OfflineBanner';
let view: ReactTestRenderer | undefined;
const buttons = () => view!.root.findAll(node => String(node.type) === 'TouchableOpacity');
const render = async () => { await act(async () => { view = create(<OfflineBanner />); }); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const refresh = async () => { await act(async () => view!.update(<OfflineBanner />)); };
function deferred() { let resolve!: (value: boolean) => void, reject!: (error: Error) => void; const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); f.isConnected = false; f.isApiReachable = false; f.isOnline = false; f.recheck.mockReset(); });
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; vi.useRealTimers(); });
it('stays visible beyond ten seconds while offline and reserves its own accessible touch target', async () => {
  await render(); expect(buttons()).toHaveLength(0); await tick(3000); await tick(60000);
  const button = buttons()[0]; expect(button.props.accessibilityRole).toBe('button'); expect(button.props.accessibilityLabel).toContain('offline');
  expect(button.props.style[0].position).toBeUndefined(); expect(button.props.style[0].minHeight).toBeGreaterThanOrEqual(44);
});
it('hides only when connectivity recovers and appears again on a later outage', async () => {
  await render(); await tick(3000); f.isConnected = true; f.isApiReachable = true; f.isOnline = true; await refresh(); expect(buttons()).toHaveLength(0);
  f.isApiReachable = false; f.isOnline = false; await refresh(); expect(buttons()[0].props.accessibilityLabel).toContain('reach Håfa');
});
it('keeps the real retry busy until completion and prevents duplicate taps', async () => {
  const gate = deferred(); f.recheck.mockReturnValue(gate.promise); await render(); await tick(3000);
  await act(async () => { buttons()[0].props.onPress(); buttons()[0].props.onPress(); });
  expect(f.recheck).toHaveBeenCalledTimes(1); expect(buttons()[0].props.accessibilityState).toEqual({ disabled: true, busy: true });
  await tick(5000); expect(buttons()[0].props.disabled).toBe(true);
  await act(async () => gate.resolve(false)); expect(buttons()[0].props.disabled).toBe(false); expect(buttons()[0].props.accessibilityLabel).toContain('Still unavailable');
});
it('recovers from a rejected retry and permits another explicit check', async () => {
  f.recheck.mockRejectedValueOnce(Error('Unavailable')).mockResolvedValueOnce(false); await render(); await tick(3000);
  await act(async () => buttons()[0].props.onPress()); expect(buttons()[0].props.disabled).toBe(false);
  await act(async () => buttons()[0].props.onPress()); expect(f.recheck).toHaveBeenCalledTimes(2); expect(buttons()).toHaveLength(1);
});
it('cleans its startup timer and ignores a late retry after unmount', async () => {
  const gate = deferred(); f.recheck.mockReturnValue(gate.promise); await render(); await tick(3000); await act(async () => buttons()[0].props.onPress());
  await act(async () => view!.unmount()); view = undefined; await act(async () => gate.reject(Error('Late failure'))); expect(vi.getTimerCount()).toBe(0);
});
it('does not report an unknown connection as offline', async () => { f.isConnected = null; f.isApiReachable = null; await render(); await tick(60000); expect(buttons()).toHaveLength(0); });

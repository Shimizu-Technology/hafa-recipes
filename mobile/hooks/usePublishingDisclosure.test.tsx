import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ alert: vi.fn(), status: vi.fn(), accept: vi.fn(), confirm: vi.fn() }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return { useFocusEffect: (callback: () => (() => void)) => useEffect(callback, [callback]) };
});
vi.mock('@/lib/api', () => ({ api: { getPublishingDisclosure: mocks.status, acceptPublishingDisclosure: mocks.accept } }));
vi.mock('@/contexts/PublishingConfirmation', () => ({ usePublishingConfirmation: () => mocks.confirm }));
import { usePublishingDisclosure } from './usePublishingDisclosure';
let hook!: ReturnType<typeof usePublishingDisclosure>;
let renderer: ReactTestRenderer;
function Harness() { hook = usePublishingDisclosure(); return null; }
beforeEach(async () => {
  vi.clearAllMocks(); mocks.status.mockResolvedValue({ requires_acceptance: true, current_version: 1 });
  mocks.accept.mockResolvedValue({ requires_acceptance: false, current_version: 1, accepted_version: 1 });
  await act(async () => { renderer = create(<Harness />); });
});
afterEach(async () => { await act(async () => renderer.unmount()); });
describe('publishing choice vs temporary failure', () => {
  it('confirms every publish even after disclosure acceptance', async () => {
    mocks.status.mockResolvedValue({ requires_acceptance: false, current_version: 1 });
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => { expect(await hook.requestPublishing()).toBe(false); });
    expect(hook.didChoosePrivate()).toBe(true);
    await act(async () => { expect(await hook.requestPublishing()).toBe(true); });
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it('records acceptance only after explicit approval', async () => {
    mocks.confirm.mockResolvedValue(true);
    await act(async () => { expect(await hook.requestPublishing()).toBe(true); });
    expect(mocks.accept).toHaveBeenCalledWith(1);
  });
  it('fails closed on acceptance or network failure', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.accept.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => { expect(await hook.requestPublishing()).toBe(false); });
    mocks.status.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => { expect(await hook.requestPublishing()).toBe(false); });
  });
});

it.each(['status', 'accept'] as const)('clears checking state when %s never responds', async (boundary) => {
  vi.useFakeTimers();
  try {
    mocks.confirm.mockResolvedValue(true);
    mocks[boundary].mockImplementationOnce(() => new Promise(() => {}));
    let result!: Promise<boolean>;
    await act(async () => { result = hook.requestPublishing(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(await result).toBe(false);
    expect(hook.isCheckingDisclosure).toBe(false);
    expect(hook.didChoosePrivate()).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('reports a prompt timeout without suggesting a connection failure or choosing private', async () => {
  mocks.confirm.mockRejectedValueOnce(Object.assign(new Error('Prompt timed out'), { name: 'TimeoutError' }));
  await act(async () => { expect(await hook.requestPublishing()).toBe(false); });
  expect(mocks.alert).toHaveBeenLastCalledWith(expect.any(String), expect.stringContaining('Publishing confirmation timed out'));
  expect(hook.didChoosePrivate()).toBe(false);
});

it('clears the prior private choice even when a concurrent request is refused', async () => {
  mocks.confirm.mockResolvedValueOnce(false);
  await act(async () => { await hook.requestPublishing(); });
  expect(hook.didChoosePrivate()).toBe(true);
  let finish!: (value: boolean) => void;
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = hook.requestPublishing(); });
  await act(async () => { expect(await hook.requestPublishing()).toBe(false); });
  expect(hook.didChoosePrivate()).toBe(false);
  await act(async () => { finish(true); await pending; });
});

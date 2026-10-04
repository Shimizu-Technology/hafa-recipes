import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ alert: vi.fn(), status: vi.fn(), accept: vi.fn() }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return { useFocusEffect: (callback: () => (() => void)) => useEffect(callback, [callback]) };
});
vi.mock('@/lib/api', () => ({ api: { getPublishingDisclosure: mocks.status, acceptPublishingDisclosure: mocks.accept } }));
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
  it('records private only when the user explicitly chooses Keep private', async () => {
    let result!: Promise<boolean>;
    await act(async () => { result = hook.requestPublishing(); });
    await act(async () => mocks.alert.mock.calls[0][2][0].onPress());
    expect(await result).toBe(false);
    expect(hook.didChoosePrivate()).toBe(true);
  });
  it('does not change public intent when the disclosure cannot be fetched', async () => {
    mocks.status.mockRejectedValueOnce(new Error('Offline'));
    let result!: boolean;
    await act(async () => { result = await hook.requestPublishing(); });
    expect(result).toBe(false);
    expect(hook.didChoosePrivate()).toBe(false);
  });
  it('does not treat dismissing the disclosure as choosing private', async () => {
    let result!: Promise<boolean>;
    await act(async () => { result = hook.requestPublishing(); });
    await act(async () => mocks.alert.mock.calls[0][3].onDismiss());
    expect(await result).toBe(false);
    expect(hook.didChoosePrivate()).toBe(false);
  });
});

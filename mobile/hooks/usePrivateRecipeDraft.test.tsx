import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
  dispatch: vi.fn(), alert: vi.fn(), guard: null as any, state: null as any }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, AppState: { addEventListener: (_: string, callback: any) => { mocks.state = callback; return { remove: vi.fn() }; } } }));
vi.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mocks.dispatch }) }));
vi.mock('expo-router/react-navigation', () => ({ usePreventRemove: (enabled: boolean, callback: any) => { mocks.guard = enabled ? callback : null; } }));
vi.mock('@/lib/privateRecipeDrafts', () => ({ privateRecipeDrafts: { subscribe: () => () => {}, lease: (owner: string) => ({ owner, epoch: 0 }), read: mocks.read, write: mocks.write, remove: mocks.remove } }));
import { usePrivateRecipeDraft } from './usePrivateRecipeDraft';
let current: ReturnType<typeof usePrivateRecipeDraft<{ title: string }>>;
const restore = vi.fn();
function Harness({ title }: { title: string }) { current = usePrivateRecipeDraft('stable-a', 'manual', { title }, !!title, restore); return null; }
describe('private draft recovery and dismissal', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.read.mockReset().mockResolvedValue(null); mocks.write.mockClear(); mocks.remove.mockClear(); mocks.dispatch.mockClear(); mocks.alert.mockClear(); restore.mockClear(); });
  it('requires Resume/Discard before overwriting prior work and restores it explicitly', async () => {
    mocks.read.mockResolvedValue({ title: 'Family recipe' });
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(<Harness title="New recipe" />));
      await act(async () => vi.advanceTimersByTime(500));
      expect(mocks.write).not.toHaveBeenCalled();
      await act(async () => current.resume());
      expect(restore).toHaveBeenCalledWith({ title: 'Family recipe' });
    } finally { await act(async () => renderer.unmount()); vi.useRealTimers(); }
  });
  it('flushes on background and guarded leave, then clears on confirmed completion', async () => {
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(<Harness title="Rice" />));
      await act(async () => mocks.state('background'));
      expect(mocks.write).toHaveBeenCalledWith({ owner: 'stable-a', epoch: 0 }, 'manual', { title: 'Rice' });
      await act(async () => mocks.guard({ data: { action: { type: 'GO_BACK' } } }));
      expect(mocks.dispatch).not.toHaveBeenCalled();
      const keep = mocks.alert.mock.calls.at(-1)![2].find((item: any) => item.text === 'Keep draft and leave');
      await act(async () => keep.onPress());
      await act(async () => vi.advanceTimersByTime(0));
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
      await act(async () => current.finish());
      expect(mocks.remove).toHaveBeenCalledWith({ owner: 'stable-a', epoch: 0 }, 'manual', { title: 'Rice' });
    } finally { await act(async () => renderer.unmount()); vi.useRealTimers(); }
  });
});

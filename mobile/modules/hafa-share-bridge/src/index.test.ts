import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ native: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mocks.native }));
import { cleanupAttachments, discardCapture } from './index';
beforeEach(() => { for (const key of Object.keys(mocks.native)) delete mocks.native[key]; });
it('uses exact native discard and preserves a failed discard rather than acknowledging it', async () => {
  mocks.native.discardCapture = vi.fn(async () => false);
  mocks.native.acknowledgeCapture = vi.fn(async () => true);
  expect(await discardCapture('capture-a', ['file:///group/pending.jpg'])).toBe(false);
  expect(mocks.native.discardCapture).toHaveBeenCalledWith('capture-a', ['file:///group/pending.jpg']);
  expect(mocks.native.acknowledgeCapture).not.toHaveBeenCalled();
});
it('keeps older native builds compatible and retains their cleanup journal', async () => {
  mocks.native.acknowledgeCapture = vi.fn(async () => true);
  expect(await discardCapture('legacy')).toBe(true);
  expect(await cleanupAttachments(['file:///group/a.jpg'], ['file:///group/b.jpg'])).toEqual(['file:///group/a.jpg']);
});
it('passes retirement and all-account protection to native and returns files needing retry', async () => {
  mocks.native.cleanupAttachments = vi.fn(async () => ['file:///group/queued.jpg']);
  expect(await cleanupAttachments(['file:///group/queued.jpg', 'file:///group/accepted.jpg'], ['file:///group/pending.jpg']))
    .toEqual(['file:///group/queued.jpg']);
  expect(mocks.native.cleanupAttachments).toHaveBeenCalledWith(
    ['file:///group/queued.jpg', 'file:///group/accepted.jpg'], ['file:///group/pending.jpg']);
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
    removeItem: mocks.removeItem,
  },
}));

import {
  enqueueChatImageCleanup,
  processChatImageCleanup,
  resetChatImageCleanupForTests,
} from './chatImageCleanup';
import { pendingChatImageCleanupKey } from './chatStorage';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('chat image cleanup queue', () => {
  const conversationKey = 'hafa.chat.v2.stable-user.recipe.recipe-1';
  const cleanupKey = pendingChatImageCleanupKey(conversationKey);

  beforeEach(() => {
    mocks.values.clear();
    mocks.getItem.mockClear();
    mocks.setItem.mockClear();
    mocks.removeItem.mockClear();
    resetChatImageCleanupForTests();
  });

  it('retains a failed job and retries it after new history is written', async () => {
    const job = { id: 'old-clear', imageUrls: ['https://images.example/old.jpg'] };
    await enqueueChatImageCleanup(conversationKey, job);
    const failingDelete = vi.fn(async () => { throw new Error('offline'); });

    await processChatImageCleanup(conversationKey, failingDelete);
    await AsyncStorage.setItem(conversationKey, JSON.stringify([{ content: 'new message' }]));
    expect(JSON.parse(mocks.values.get(cleanupKey)!)).toEqual([job]);

    const successfulDelete = vi.fn(async () => ({ deleted: 1 }));
    await processChatImageCleanup(conversationKey, successfulDelete);

    expect(successfulDelete).toHaveBeenCalledWith(job.imageUrls);
    expect(mocks.values.has(cleanupKey)).toBe(false);
    expect(mocks.values.has(conversationKey)).toBe(true);
  });

  it('preserves a newer overlapping job when an older deletion finishes', async () => {
    const firstDelete = deferred<unknown>();
    const deleteImages = vi.fn()
      .mockImplementationOnce(() => firstDelete.promise)
      .mockRejectedValueOnce(new Error('second cleanup offline'));
    const first = { id: 'first-clear', imageUrls: ['https://images.example/first.jpg'] };
    const second = { id: 'second-clear', imageUrls: ['https://images.example/second.jpg'] };

    await enqueueChatImageCleanup(conversationKey, first);
    const processing = processChatImageCleanup(conversationKey, deleteImages);
    await Promise.resolve();
    await enqueueChatImageCleanup(conversationKey, second);
    firstDelete.resolve({ deleted: 1 });
    await processing;

    expect(deleteImages).toHaveBeenNthCalledWith(1, first.imageUrls);
    expect(deleteImages).toHaveBeenNthCalledWith(2, second.imageUrls);
    expect(JSON.parse(mocks.values.get(cleanupKey)!)).toEqual([second]);
  });
});

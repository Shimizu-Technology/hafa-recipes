import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
    getAllKeys: vi.fn(async () => [...values.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => values.delete(key)); }),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
    removeItem: mocks.removeItem,
    getAllKeys: mocks.getAllKeys,
    multiRemove: mocks.multiRemove,
  },
}));

import { clearAccountChatStorage, readChatDraft, resetChatDraftsForTests, writeChatDraft, writeChatHistory } from './chatDrafts';
import { enqueueChatImageCleanup, resetChatImageCleanupForTests } from './chatImageCleanup';
import { chatDraftStorageKey, chatStorageKey, pendingChatImageCleanupKey } from './chatStorage';

describe('chat drafts', () => {
  const conversationKey = 'hafa.chat.v2.user.recipe.one';
  const draftKey = chatDraftStorageKey(conversationKey);

  beforeEach(() => {
    mocks.values.clear();
    mocks.getItem.mockClear();
    mocks.setItem.mockClear();
    mocks.removeItem.mockClear();
    mocks.getAllKeys.mockClear();
    mocks.multiRemove.mockClear();
    resetChatDraftsForTests();
    resetChatImageCleanupForTests();
  });

  it('stores, reads, and removes a conversation draft', async () => {
    await writeChatDraft(conversationKey, 'Use coconut milk');
    expect(await readChatDraft(conversationKey)).toBe('Use coconut milk');
    await writeChatDraft(conversationKey, '');
    expect(mocks.values.has(draftKey)).toBe(false);
  });

  it('keeps a clear ordered after an already-started save', async () => {
    let finishSave!: () => void;
    mocks.setItem.mockImplementationOnce(async (key: string, value: string) => {
      await new Promise<void>((resolve) => { finishSave = resolve; });
      mocks.values.set(key, value);
    });

    const saving = writeChatDraft(conversationKey, 'stale text');
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'));
    const clearing = writeChatDraft(conversationKey, '');
    finishSave();
    await Promise.all([saving, clearing]);

    expect(mocks.values.has(draftKey)).toBe(false);
  });

  it('clears only the deleted account after an in-flight draft save', async () => {
    const ownConversation = chatStorageKey('stable-user', 'one');
    const otherConversation = chatStorageKey('stable-user-other', 'one');
    mocks.values.set(ownConversation, '[{"content":"private"}]');
    mocks.values.set(pendingChatImageCleanupKey(ownConversation), '[]');
    mocks.values.set(otherConversation, '[{"content":"keep"}]');

    let finishSave!: () => void;
    mocks.setItem.mockImplementationOnce(async (key: string, value: string) => {
      await new Promise<void>((resolve) => { finishSave = resolve; });
      mocks.values.set(key, value);
    });
    const saving = writeChatDraft(ownConversation, 'unsent text');
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'));
    const clearing = clearAccountChatStorage('stable-user');
    finishSave();
    await Promise.all([saving, clearing]);

    expect([...mocks.values.keys()]).toEqual([otherConversation]);
    expect(mocks.multiRemove).toHaveBeenCalledWith(expect.arrayContaining([
      ownConversation,
      chatDraftStorageKey(ownConversation),
      pendingChatImageCleanupKey(ownConversation),
    ]));
  });

  it('prevents a modal from restoring drafts or history after account deletion', async () => {
    const conversation = chatStorageKey('stable-user', 'one');
    await writeChatHistory(conversation, '[{"content":"before"}]');
    await clearAccountChatStorage('stable-user');

    await writeChatDraft(conversation, 'late unsent text');
    await writeChatHistory(conversation, '[{"content":"late"}]');

    expect(await readChatDraft(conversation)).toBe('');
    expect(mocks.values.has(conversation)).toBe(false);
    expect(mocks.values.has(chatDraftStorageKey(conversation))).toBe(false);
  });

  it('drains image-cleanup writes and blocks image URLs after deletion', async () => {
    const conversation = chatStorageKey('stable-user', 'one');
    const cleanupKey = pendingChatImageCleanupKey(conversation);
    let finishWrite!: () => void;
    mocks.setItem.mockImplementationOnce(async (key: string, value: string) => {
      await new Promise<void>((resolve) => { finishWrite = resolve; });
      mocks.values.set(key, value);
    });

    const first = enqueueChatImageCleanup(conversation, {
      id: 'before', imageUrls: ['https://example.com/chat-photo.jpg'],
    });
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    const clearing = clearAccountChatStorage('stable-user');
    finishWrite();
    await Promise.all([first, clearing]);
    await enqueueChatImageCleanup(conversation, {
      id: 'after', imageUrls: ['https://example.com/late-photo.jpg'],
    });

    expect(mocks.values.has(cleanupKey)).toBe(false);
  });
});

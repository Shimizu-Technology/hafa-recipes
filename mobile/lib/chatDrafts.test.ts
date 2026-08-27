import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { readChatDraft, resetChatDraftsForTests, writeChatDraft } from './chatDrafts';
import { chatDraftStorageKey } from './chatStorage';

describe('chat drafts', () => {
  const conversationKey = 'hafa.chat.v2.user.recipe.one';
  const draftKey = chatDraftStorageKey(conversationKey);

  beforeEach(() => {
    mocks.values.clear();
    mocks.getItem.mockClear();
    mocks.setItem.mockClear();
    mocks.removeItem.mockClear();
    resetChatDraftsForTests();
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
});

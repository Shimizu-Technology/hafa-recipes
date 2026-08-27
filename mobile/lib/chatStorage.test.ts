import { describe, expect, it } from 'vitest';

import {
  chatStorageKey,
  legacyChatStorageKey,
  pendingChatImageCleanupKey,
  persistedChatImageUrls,
} from './chatStorage';

describe('account-scoped chat storage', () => {
  it('isolates identical conversations by stable application user', () => {
    expect(chatStorageKey('app-user-a', 'recipe-1')).not.toBe(
      chatStorageKey('app-user-b', 'recipe-1'),
    );
    expect(chatStorageKey('app-user-a')).toBe('hafa.chat.v2.app-user-a.cooking');
  });

  it('never uses the legacy unscoped key for new storage', () => {
    expect(chatStorageKey('app-user', 'recipe-1')).not.toBe(legacyChatStorageKey('recipe-1'));
    expect(chatStorageKey('app-user')).not.toBe(legacyChatStorageKey());
  });

  it('scopes pending image cleanup to the same account conversation', () => {
    const conversation = chatStorageKey('app-user-a', 'recipe-1');
    expect(pendingChatImageCleanupKey(conversation)).toBe(
      'hafa.chat.v2.app-user-a.recipe.recipe-1.pending-image-cleanup',
    );
  });

  it('collects only unique persisted HTTPS image references', () => {
    expect(persistedChatImageUrls([
      { role: 'user', content: 'one', image_url: 'https://cdn.example/one.jpg' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'again', image_url: 'https://cdn.example/one.jpg' },
      { role: 'user', content: 'local', image_url: 'file:///draft.jpg' },
    ])).toEqual(['https://cdn.example/one.jpg']);
  });
});

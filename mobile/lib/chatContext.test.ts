import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types/recipe';

import {
  beginMessageDelivery,
  completeMessageDelivery,
  interruptMessageDelivery,
  LEGACY_CHAT_ERROR_MESSAGE,
  MAX_CHAT_CONTEXT_MESSAGES,
  normalizeStoredChatMessages,
  messagesForStorage,
  selectChatContext,
  upsertStreamingResponse,
} from './chatContext';

describe('selectChatContext', () => {
  it('keeps only the newest complete sent turns', () => {
    const messages: ChatMessage[] = Array.from({ length: 7 }, (_, index) => [
      { role: 'user' as const, content: `question ${index}`, status: 'sent' as const },
      { role: 'assistant' as const, content: `answer ${index}`, status: 'sent' as const },
    ]).flat();
    messages.push({ role: 'user', content: 'failed', status: 'failed' });

    const selected = selectChatContext(messages);

    expect(selected).toHaveLength(MAX_CHAT_CONTEXT_MESSAGES);
    expect(selected[0].content).toBe('question 2');
    expect(selected.at(-1)?.content).toBe('answer 6');
  });

  it('drops orphaned messages and the legacy fake assistant error turn', () => {
    const selected = selectChatContext([
      { role: 'assistant', content: 'orphan' },
      { role: 'user', content: 'failed question' },
      { role: 'assistant', content: LEGACY_CHAT_ERROR_MESSAGE },
      { role: 'user', content: 'good question' },
      { role: 'assistant', content: 'good answer' },
      { role: 'user', content: 'pending question', status: 'sending' },
    ]);

    expect(selected.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'good question' },
      { role: 'assistant', content: 'good answer' },
    ]);
  });

  it('does not pair a user with an assistant after a failed assistant response', () => {
    expect(selectChatContext([
      { role: 'user', content: 'question', status: 'sent' },
      { role: 'assistant', content: 'failed answer', status: 'failed' },
      { role: 'assistant', content: 'orphan answer', status: 'sent' },
    ])).toEqual([]);
  });

  it('does not exceed the character budget or retain local image URLs', () => {
    const selected = selectChatContext([
      { role: 'user', content: 'x'.repeat(9_000) },
      { role: 'assistant', content: 'y'.repeat(9_000) },
      { role: 'user', content: 'new', image_url: 'file:///photo.jpg' },
      { role: 'assistant', content: 'answer' },
    ]);

    expect(selected).toEqual([
      { role: 'user', content: 'new', image_url: undefined },
      { role: 'assistant', content: 'answer', image_url: undefined },
    ]);
  });
});

describe('normalizeStoredChatMessages', () => {
  it('marks interrupted sends as failed and assigns stable UI fields', () => {
    const [message] = normalizeStoredChatMessages([
      { role: 'user', content: 'hello', status: 'sending' },
    ]);

    expect(message.id).toBeTruthy();
    expect(message.status).toBe('failed');
    expect(message.error_message).toContain('interrupted');
  });
});

describe('messagesForStorage', () => {
  it('drops device-local image URLs and preserves HTTPS image URLs', () => {
    const messages = normalizeStoredChatMessages([
      { id: 'local', role: 'user', content: 'local', image_url: 'file:///photo.jpg' },
      { id: 'owned', role: 'user', content: 'owned', image_url: 'https://images.example/photo.jpg' },
    ]);

    expect(messagesForStorage(messages).map((message) => message.image_url)).toEqual([
      undefined,
      'https://images.example/photo.jpg',
    ]);
  });
});

describe('message delivery ordering', () => {
  it('retries in place with only the messages that preceded the failed send', () => {
    const messages = normalizeStoredChatMessages([
      { id: 'first-user', role: 'user', content: 'first' },
      { id: 'first-answer', role: 'assistant', content: 'answer' },
      { id: 'failed-user', role: 'user', content: 'failed', status: 'failed' },
      { id: 'later-user', role: 'user', content: 'later' },
      { id: 'later-answer', role: 'assistant', content: 'later answer' },
    ]);
    const failed = { ...messages[2], status: 'sending' as const };

    const started = beginMessageDelivery(messages, failed);
    const completed = completeMessageDelivery(started.displayMessages, failed.id, {
      id: 'retried-answer',
      role: 'assistant',
      content: 'retried answer',
      status: 'sent',
    });

    expect(started.contextMessages.map((message) => message.id)).toEqual([
      'first-user',
      'first-answer',
    ]);
    expect(completed.map((message) => message.id)).toEqual([
      'first-user',
      'first-answer',
      'failed-user',
      'retried-answer',
      'later-user',
      'later-answer',
    ]);
  });

  it('updates a partial answer in place and replaces it on completion', () => {
    const [user] = normalizeStoredChatMessages([
      { id: 'user', role: 'user', content: 'question', status: 'sending' },
    ]);
    const partial = {
      id: 'assistant',
      role: 'assistant' as const,
      content: 'partial',
      status: 'sending' as const,
    };
    const streamed = upsertStreamingResponse([user], user.id, partial);
    const updated = upsertStreamingResponse(streamed, user.id, {
      ...partial,
      content: 'partial answer',
    });
    const completed = completeMessageDelivery(updated, user.id, {
      ...partial,
      content: 'complete answer',
      status: 'sent',
    });

    expect(updated.map((message) => message.content)).toEqual(['question', 'partial answer']);
    expect(completed).toHaveLength(2);
    expect(completed[1]).toMatchObject({ content: 'complete answer', status: 'sent' });
  });

  it('ignores a streamed response after its user message leaves the conversation', () => {
    const messages = normalizeStoredChatMessages([
      { id: 'current-user', role: 'user', content: 'current question' },
      { id: 'current-answer', role: 'assistant', content: 'current answer' },
    ]);

    const result = upsertStreamingResponse(messages, 'prior-user', {
      id: 'prior-partial',
      role: 'assistant',
      content: 'late partial from another conversation',
      status: 'sending',
    });

    expect(result).toBe(messages);
    expect(result).toEqual(messages);
  });

  it('removes partial output and preserves a cancellable user message', () => {
    const messages = normalizeStoredChatMessages([
      { id: 'user', role: 'user', content: 'question' },
      { id: 'assistant', role: 'assistant', content: 'partial', status: 'sending' },
    ]);
    expect(interruptMessageDelivery(
      messages,
      'user',
      'assistant',
      'cancelled',
      'Response stopped. You can retry this message.',
    )).toEqual([
      expect.objectContaining({
        id: 'user',
        status: 'cancelled',
        error_message: 'Response stopped. You can retry this message.',
      }),
    ]);
  });
});

import type { ChatMessage } from '@/types/recipe';

export const MAX_CHAT_CONTEXT_MESSAGES = 10;
export const MAX_CHAT_CONTEXT_CHARS = 16_000;
export const LEGACY_CHAT_ERROR_MESSAGE = "Sorry, I couldn't process that request. Please try again.";

export type ChatDeliveryStatus = 'sending' | 'sent' | 'failed' | 'cancelled';

export interface ChatUiMessage extends ChatMessage {
  id: string;
  status: ChatDeliveryStatus;
  error_message?: string;
  request_content?: string;
}

export function createChatMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeStoredChatMessages(messages: ChatMessage[]): ChatUiMessage[] {
  return messages.map((message) => ({
    ...message,
    id: message.id || createChatMessageId(),
    status: message.status === 'sending' ? 'failed' : (message.status || 'sent'),
    error_message: message.status === 'sending'
      ? 'This message was interrupted. Try sending it again.'
      : message.error_message,
  }));
}

export function selectChatContext(messages: ChatMessage[]): ChatMessage[] {
  const turns: Array<[ChatMessage, ChatMessage]> = [];
  let pendingUser: ChatMessage | undefined;

  for (const message of messages) {
    if (message.status && message.status !== 'sent') {
      if (message.role === 'user') pendingUser = undefined;
      continue;
    }
    if (message.role === 'user') {
      pendingUser = message;
      continue;
    }
    if (message.content.trim() === LEGACY_CHAT_ERROR_MESSAGE) {
      pendingUser = undefined;
      continue;
    }
    if (pendingUser) {
      turns.push([pendingUser, message]);
      pendingUser = undefined;
    }
  }

  const selected: Array<[ChatMessage, ChatMessage]> = [];
  let selectedChars = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnChars = turn[0].content.length + turn[1].content.length;
    if (selected.length * 2 + 2 > MAX_CHAT_CONTEXT_MESSAGES) break;
    if (selectedChars + turnChars > MAX_CHAT_CONTEXT_CHARS) break;
    selected.push(turn);
    selectedChars += turnChars;
  }

  return selected.reverse().flatMap((turn) => turn.map((message) => ({
    role: message.role,
    content: message.content,
    image_url: message.image_url?.startsWith('https://') ? message.image_url : undefined,
  })));
}

export function messagesForStorage(messages: ChatUiMessage[]): ChatUiMessage[] {
  return messages.map((message) => ({
    ...message,
    image_url: message.image_url?.startsWith('https://') ? message.image_url : undefined,
  }));
}

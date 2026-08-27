import type { ChatDeliveryStatus, ChatMessage } from '@/types/recipe';

export type { ChatDeliveryStatus } from '@/types/recipe';

export const MAX_CHAT_CONTEXT_MESSAGES = 10;
export const MAX_CHAT_CONTEXT_CHARS = 16_000;
export const LEGACY_CHAT_ERROR_MESSAGE = "Sorry, I couldn't process that request. Please try again.";

export interface ChatUiMessage extends ChatMessage {
  id: string;
  status: ChatDeliveryStatus;
  error_message?: string;
  request_content?: string;
}

export interface ChatDeliveryStart {
  contextMessages: ChatUiMessage[];
  displayMessages: ChatUiMessage[];
}

/** Create a locally unique identifier for stable message rendering and retries. */
export function createChatMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Upgrade legacy persisted messages and convert interrupted sends to failures. */
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

/** Keep retries in place and limit their request context to preceding messages. */
export function beginMessageDelivery(
  messages: ChatUiMessage[],
  sendingMessage: ChatUiMessage,
): ChatDeliveryStart {
  const existingIndex = messages.findIndex((message) => message.id === sendingMessage.id);
  if (existingIndex < 0) {
    return {
      contextMessages: messages,
      displayMessages: [...messages, sendingMessage],
    };
  }
  return {
    contextMessages: messages.slice(0, existingIndex),
    displayMessages: messages.map((message) => message.id === sendingMessage.id
      ? sendingMessage
      : message),
  };
}

/** Insert the assistant response immediately after the delivered user bubble. */
export function completeMessageDelivery(
  messages: ChatUiMessage[],
  userMessageId: string,
  assistantMessage: ChatUiMessage,
  imageUrl?: string,
): ChatUiMessage[] {
  const userIndex = messages.findIndex((message) => message.id === userMessageId);
  if (userIndex < 0) return messages;
  const deliveredMessages = messages.map((message) => message.id === userMessageId
    ? { ...message, status: 'sent' as const, image_url: imageUrl || message.image_url }
    : message);
  return [
    ...deliveredMessages.slice(0, userIndex + 1),
    assistantMessage,
    ...deliveredMessages.slice(userIndex + 1),
  ];
}

/** Select the newest complete, delivered turns that fit the provider budget. */
export function selectChatContext(messages: ChatMessage[]): ChatMessage[] {
  const turns: Array<[ChatMessage, ChatMessage]> = [];
  let pendingUser: ChatMessage | undefined;

  for (const message of messages) {
    if (message.status && message.status !== 'sent') {
      pendingUser = undefined;
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

/** Remove device-local image URLs before persisting chat messages. */
export function messagesForStorage(messages: ChatUiMessage[]): ChatUiMessage[] {
  return messages.map((message) => ({
    ...message,
    image_url: message.image_url?.startsWith('https://') ? message.image_url : undefined,
  }));
}

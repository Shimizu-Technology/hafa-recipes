import type { ChatMessage } from '@/types/recipe';

const STORAGE_PREFIX = 'hafa.chat.v2';
export const LEGACY_COOKING_CHAT_KEY = 'cooking_assistant_chat';
export const LEGACY_RECIPE_CHAT_PREFIX = 'recipe_chat_';

/** Match only this application's account-scoped chat keys, including drafts. */
export function accountChatStoragePrefix(appUserId: string): string {
  if (!appUserId.trim()) throw new Error('A stable application user is required');
  return `${STORAGE_PREFIX}.${encodeURIComponent(appUserId)}.`;
}

/** Build a conversation key from the durable backend identity, never a Clerk subject. */
export function chatStorageKey(appUserId: string, recipeId?: string): string {
  const ownerPrefix = accountChatStoragePrefix(appUserId);
  return recipeId
    ? `${ownerPrefix}recipe.${encodeURIComponent(recipeId)}`
    : `${ownerPrefix}cooking`;
}

/** Identify the corresponding pre-account-scoping key so it can be discarded. */
export function legacyChatStorageKey(recipeId?: string): string {
  return recipeId ? `${LEGACY_RECIPE_CHAT_PREFIX}${recipeId}` : LEGACY_COOKING_CHAT_KEY;
}

/** Keep failed remote cleanup durable without mixing it into message history. */
export function pendingChatImageCleanupKey(conversationKey: string): string {
  return `${conversationKey}.pending-image-cleanup`;
}

/** Keep an unsent text draft isolated with its account-scoped conversation. */
export function chatDraftStorageKey(conversationKey: string): string {
  return `${conversationKey}.draft`;
}

/** Return each persisted HTTPS image once for exact server-side cleanup. */
export function persistedChatImageUrls(messages: ChatMessage[]): string[] {
  return [...new Set(messages.flatMap((message) => (
    message.image_url?.startsWith('https://') ? [message.image_url] : []
  )))];
}

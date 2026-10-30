import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertRecipeScope, recipeScope } from './recipeQueryScope';
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

/** A conversation key is durable; an operation on it is generation-bound. */
export function chatStorageGuard(conversationKey: string, scope = recipeScope()) {
  return () => {
    assertRecipeScope(scope);
    const owner = JSON.parse(scope)[1] as string | null;
    if (owner && !conversationKey.startsWith(accountChatStoragePrefix(owner))) throw new Error('Chat account changed');
  };
}

/** Compensate a native storage call that was dispatched before retirement. */
export async function commitChatStorage(key: string, value: string | null, guard: () => void, blocked: () => boolean) {
  const previous = await AsyncStorage.getItem(key); guard();
  if (value === null) await AsyncStorage.removeItem(key); else await AsyncStorage.setItem(key, value);
  try { guard(); } catch (error) {
    if (await AsyncStorage.getItem(key) === value) {
      if (previous === null || blocked()) await AsyncStorage.removeItem(key);
      else await AsyncStorage.setItem(key, previous);
    }
    throw error;
  }
}

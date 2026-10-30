import { recipeScope } from './recipeQueryScope';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHAT_MESSAGE_MAX_CHARS } from './chatComposer';
import { blockAccountChatImageCleanup } from './chatImageCleanup';
import { accountChatStoragePrefix, chatDraftStorageKey, chatStorageGuard, commitChatStorage } from './chatStorage';

const operationTails = new Map<string, Promise<void>>();
const deletedAccountPrefixes = new Set<string>();

function belongsToDeletedAccount(conversationKey: string): boolean {
  return [...deletedAccountPrefixes].some((prefix) => conversationKey.startsWith(prefix));
}

/** Queue one draft operation so a late save cannot overwrite a newer clear. */
async function afterPendingDraftWrites<T>(
  conversationKey: string,
  operation: () => Promise<T>,
  scope = recipeScope(),
): Promise<T> {
  const guard = chatStorageGuard(conversationKey, scope);
  guard();
  const previous = operationTails.get(conversationKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  operationTails.set(conversationKey, current);
  await previous.catch(() => undefined);
  try {
    guard();
    const result = await operation();
    guard();
    return result;
  } finally {
    release();
    if (operationTails.get(conversationKey) === current) {
      operationTails.delete(conversationKey);
    }
  }
}

/** Read a bounded draft only after earlier writes for this conversation settle. */
export async function readChatDraft(conversationKey: string): Promise<string> {
  if (belongsToDeletedAccount(conversationKey)) return '';
  return afterPendingDraftWrites(conversationKey, async () => (
    belongsToDeletedAccount(conversationKey)
      ? ''
      : await AsyncStorage.getItem(chatDraftStorageKey(conversationKey)) ?? ''
  ).slice(0, CHAT_MESSAGE_MAX_CHARS));
}

/** Save or remove a bounded account-scoped text draft in invocation order. */
export async function writeChatDraft(conversationKey: string, text: string, scope = recipeScope()): Promise<void> {
  if (belongsToDeletedAccount(conversationKey)) return;
  await afterPendingDraftWrites(conversationKey, async () => {
    if (belongsToDeletedAccount(conversationKey)) return;
    const key = chatDraftStorageKey(conversationKey);
    await commitChatStorage(key, text.trim() ? text.slice(0, CHAT_MESSAGE_MAX_CHARS) : null, chatStorageGuard(conversationKey, scope), () => belongsToDeletedAccount(key));
  }, scope);
}

/** Serialize history writes with drafts so account deletion can drain both. */
export async function writeChatHistory(conversationKey: string, serialized: string, scope = recipeScope()): Promise<void> {
  if (belongsToDeletedAccount(conversationKey)) return;
  await afterPendingDraftWrites(conversationKey, async () => {
    if (!belongsToDeletedAccount(conversationKey)) {
      await commitChatStorage(conversationKey, serialized, chatStorageGuard(conversationKey, scope), () => belongsToDeletedAccount(conversationKey));
    }
  }, scope);
}

/** Remove this account's locally stored conversations after server deletion. */
export async function clearAccountChatStorage(appUserId: string): Promise<void> {
  const prefix = accountChatStoragePrefix(appUserId);
  deletedAccountPrefixes.add(prefix);
  await blockAccountChatImageCleanup(appUserId);
  await Promise.all(
    [...operationTails.entries()]
      .filter(([conversationKey]) => conversationKey.startsWith(prefix))
      .map(([, tail]) => tail),
  );
  const keys = await AsyncStorage.getAllKeys();
  const accountKeys = keys.filter((key) => key.startsWith(prefix));
  if (accountKeys.length > 0) await AsyncStorage.multiRemove(accountKeys);
}

export function resetChatDraftsForTests(): void {
  operationTails.clear();
  deletedAccountPrefixes.clear();
}

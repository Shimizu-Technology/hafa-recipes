import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHAT_MESSAGE_MAX_CHARS } from './chatComposer';
import { accountChatStoragePrefix, chatDraftStorageKey } from './chatStorage';

const operationTails = new Map<string, Promise<void>>();

/** Queue one draft operation so a late save cannot overwrite a newer clear. */
async function afterPendingDraftWrites<T>(
  conversationKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = operationTails.get(conversationKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  operationTails.set(conversationKey, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (operationTails.get(conversationKey) === current) {
      operationTails.delete(conversationKey);
    }
  }
}

/** Read a bounded draft only after earlier writes for this conversation settle. */
export async function readChatDraft(conversationKey: string): Promise<string> {
  return afterPendingDraftWrites(conversationKey, async () => (
    await AsyncStorage.getItem(chatDraftStorageKey(conversationKey)) ?? ''
  ).slice(0, CHAT_MESSAGE_MAX_CHARS));
}

/** Save or remove a bounded account-scoped text draft in invocation order. */
export async function writeChatDraft(conversationKey: string, text: string): Promise<void> {
  await afterPendingDraftWrites(conversationKey, async () => {
    const key = chatDraftStorageKey(conversationKey);
    if (text.trim()) await AsyncStorage.setItem(key, text.slice(0, CHAT_MESSAGE_MAX_CHARS));
    else await AsyncStorage.removeItem(key);
  });
}

/** Remove this account's locally stored conversations after server deletion. */
export async function clearAccountChatStorage(appUserId: string): Promise<void> {
  const prefix = accountChatStoragePrefix(appUserId);
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
}

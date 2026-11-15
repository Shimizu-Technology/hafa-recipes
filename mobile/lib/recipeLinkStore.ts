import * as SecureStore from 'expo-secure-store';

/**
 * The API returns an unlisted link only when it is created, so the owner's phone keeps it in the
 * keychain to send again later. It is scoped to the signed-in account and never logged.
 */
export type StoredRecipeLink = { url: string; createdAt: string | null };

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

function storeKey(owner: string, recipeId: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');
  return `hafa.recipeLink.${safe(owner)}.${safe(recipeId)}`;
}

export async function readStoredRecipeLink(owner: string, recipeId: string): Promise<StoredRecipeLink | null> {
  try {
    const raw = await SecureStore.getItemAsync(storeKey(owner, recipeId), OPTIONS);
    const value = raw ? JSON.parse(raw) : null;
    return typeof value?.url === 'string' ? { url: value.url, createdAt: typeof value.createdAt === 'string' ? value.createdAt : null } : null;
  } catch {
    return null;
  }
}

export async function storeRecipeLink(owner: string, recipeId: string, link: StoredRecipeLink): Promise<void> {
  await SecureStore.setItemAsync(storeKey(owner, recipeId), JSON.stringify(link), OPTIONS).catch(() => undefined);
}

export async function forgetRecipeLink(owner: string, recipeId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storeKey(owner, recipeId), OPTIONS).catch(() => undefined);
}

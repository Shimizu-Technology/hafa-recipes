import * as SecureStore from 'expo-secure-store';
import { offlineRecipes } from './offlineRecipes';

/**
 * The API returns an unlisted link only when it is created, so the owner's phone keeps it in the
 * keychain to send again later. Links belong to the stable application owner (the authority
 * offlineRecipes verifies, never the Clerk subject) and are wiped when that authority retires:
 * sign-out or an account switch. Never logged.
 */
export type StoredRecipeLink = { url: string; createdAt: string | null };

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');
const linkKey = (owner: string, recipeId: string) => `hafa.recipeLink.${safe(owner)}.${safe(recipeId)}`;
// SecureStore can't list keys, so each owner keeps an index of the recipes it holds links for.
const indexKey = (owner: string) => `hafa.recipeLinkIndex.${safe(owner)}`;

let tail: Promise<unknown> = Promise.resolve();
const run = <T,>(job: () => Promise<T>) => { const next = tail.then(job); tail = next.catch(() => undefined); return next; };

/** The verified application owner, or null before verification (then nothing is read or kept). */
export function currentLinkOwner(): string | null {
  const generation = offlineRecipes.ownerGeneration();
  if (!generation) return null;
  const [owner] = JSON.parse(generation) as [string, string];
  return owner || null;
}

async function readIndex(owner: string): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(indexKey(owner), OPTIONS);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(owner: string, ids: string[]) {
  if (ids.length) await SecureStore.setItemAsync(indexKey(owner), JSON.stringify(ids), OPTIONS);
  else await SecureStore.deleteItemAsync(indexKey(owner), OPTIONS);
}

export function readStoredRecipeLink(recipeId: string): Promise<StoredRecipeLink | null> {
  const owner = currentLinkOwner();
  if (!owner) return Promise.resolve(null);
  return run(async () => {
    try {
      const raw = await SecureStore.getItemAsync(linkKey(owner, recipeId), OPTIONS);
      const value = raw ? JSON.parse(raw) : null;
      if (currentLinkOwner() !== owner || typeof value?.url !== 'string') return null;
      return { url: value.url, createdAt: typeof value.createdAt === 'string' ? value.createdAt : null };
    } catch {
      return null;
    }
  });
}

export function storeRecipeLink(recipeId: string, link: StoredRecipeLink): Promise<void> {
  // Freeze the owner before queueing, so a late write never lands in the next account.
  const owner = currentLinkOwner();
  if (!owner) return Promise.resolve();
  return run(async () => {
    if (currentLinkOwner() !== owner) return;
    await SecureStore.setItemAsync(linkKey(owner, recipeId), JSON.stringify(link), OPTIONS);
    const ids = await readIndex(owner);
    if (!ids.includes(recipeId)) await writeIndex(owner, [...ids, recipeId]);
  }).catch(() => undefined);
}

export function forgetRecipeLink(recipeId: string): Promise<void> {
  const owner = currentLinkOwner();
  if (!owner) return Promise.resolve();
  return run(async () => {
    await SecureStore.deleteItemAsync(linkKey(owner, recipeId), OPTIONS);
    const ids = await readIndex(owner);
    if (ids.includes(recipeId)) await writeIndex(owner, ids.filter(id => id !== recipeId));
  }).catch(() => undefined);
}

/** Remove every link kept for one owner. */
export function forgetOwnerRecipeLinks(owner: string): Promise<void> {
  return run(async () => {
    const ids = await readIndex(owner);
    await Promise.all(ids.map(id => SecureStore.deleteItemAsync(linkKey(owner, id), OPTIONS).catch(() => undefined)));
    await SecureStore.deleteItemAsync(indexKey(owner), OPTIONS);
  }).catch(() => undefined);
}

/**
 * Sign-out or an account switch retires the owner, and their links leave this phone with them.
 * Rebinding the same person also retires the authority briefly, so wait until the next state is
 * known: signed out, or a different verified owner. The same owner coming back keeps their links.
 */
export function watchRecipeLinkOwners(source: Pick<typeof offlineRecipes, 'onRetire' | 'subscribe' | 'scope'>, forget: (owner: string) => unknown) {
  let retired: string | null = null;
  const settle = () => {
    if (!retired) return;
    const [subject, owner] = JSON.parse(source.scope()) as [string | null, string | null];
    if (owner === retired) retired = null;
    else if (!subject || owner) { const gone = retired; retired = null; void forget(gone); }
  };
  const stopRetire = source.onRetire(previous => { if (previous?.owner) retired = previous.owner; });
  const stopChanges = source.subscribe(settle);
  return () => { stopRetire(); stopChanges(); };
}
watchRecipeLinkOwners(offlineRecipes, forgetOwnerRecipeLinks);

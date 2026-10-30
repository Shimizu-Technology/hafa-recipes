import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { api } from './api';
import { assertRecipeScope, recipeScope } from './recipeQueryScope';
import { assertGroceryStorageLease, getGroceryStorageLease } from './offlineStorage';
import type { PantrySnapshot } from '@/types/pantry';

type Job = { id: string; kind: 'write' | 'transfer' | 'copy'; scope: 'active' | 'personal'; input: any };
const prefix = 'hafa.pending-pantry.v1:';
let tail: Promise<unknown> = Promise.resolve();
let storageTail: Promise<unknown> = Promise.resolve();
const stored = <T,>(job: () => Promise<T>) => { const next = storageTail.then(job); storageTail = next.catch(() => undefined); return next; };
const ownerKey = (scope: string) => {
  const owner = JSON.parse(scope)[1];
  if (!owner) throw new Error('Verify your account before changing the pantry.');
  return prefix + encodeURIComponent(owner);
};

/** Durable payloads keep their stable owner; each replay acquires fresh authority. */
export function replayPantryWrites(authority = recipeScope(), requestedScope?: 'active' | 'personal'): Promise<PantrySnapshot | undefined> {
  const key = ownerKey(authority);
  const run = async () => {
    assertRecipeScope(authority);
    const lease = getGroceryStorageLease();
    const guard = () => { assertRecipeScope(authority); assertGroceryStorageLease(lease); };
    let latest: PantrySnapshot | undefined;
    while (true) {
      guard();
      const job = await stored(async () => { guard(); return (JSON.parse(await AsyncStorage.getItem(key) || '[]') as Job[]).find(job => !requestedScope || job.scope === requestedScope); });
      guard(); if (!job) return latest;
      const remove = () => stored(async () => {
        guard(); const jobs = JSON.parse(await AsyncStorage.getItem(key) || '[]') as Job[]; guard();
        const raw = JSON.stringify(jobs.filter(value => value.id !== job.id));
        await AsyncStorage.setItem(key, raw);
        try { guard(); } catch (error) {
          if (await AsyncStorage.getItem(key) === raw) await AsyncStorage.setItem(key, JSON.stringify(jobs));
          throw error;
        }
      });
      try {
        const snapshot = await api.getPantrySnapshot(job.scope, guard); guard();
        if (job.kind === 'write') {
          const input = job.input;
          if (input.operation !== 'add' && snapshot.space_id !== input.space_id) throw new Error('Pantry scope changed; refresh before editing.');
          latest = await api.syncPantryMutation({ ...input, mutation_id: job.id, space_id: input.operation === 'add' ? snapshot.space_id : input.space_id, scope: job.scope, item_id: input.operation === 'add' ? job.id : input.item_id }, guard);
        } else if (job.kind === 'copy') {
          if (snapshot.scope !== 'household') throw new Error('A shared household pantry is not active.');
          latest = await api.copyPersonalPantryToHousehold({ mutation_id: job.id, space_id: snapshot.space_id }, guard);
        } else {
          if (!snapshot.list_id) throw new Error('Refresh your pantry and grocery list before transferring items.');
          latest = await api.transferGroceriesToPantry({ mutation_id: job.id, space_id: snapshot.space_id, list_id: snapshot.list_id, items: job.input }, guard);
        }
      } catch (error: any) {
        guard();
        const status = error?.response?.status;
        // Definitive validation/conflict failures must not block later valid work.
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) await remove();
        throw error;
      }
      guard(); await remove();
    }
  };
  const result = tail.then(run, run); tail = result.catch(() => undefined); return result;
}

export async function submitPantryWrite(kind: Job['kind'], scope: Job['scope'], input?: unknown) {
  const authority = recipeScope(), key = ownerKey(authority);
  const chunks = kind === 'transfer' ? Array.from({ length: Math.ceil((input as unknown[]).length / 100) }, (_, index) => (input as unknown[]).slice(index * 100, index * 100 + 100)) : [input];
  const jobs = chunks.map(value => ({ id: randomUUID(), kind, scope, input: value }));
  await stored(async () => {
    assertRecipeScope(authority); const prior = JSON.parse(await AsyncStorage.getItem(key) || '[]') as Job[]; assertRecipeScope(authority);
    const fresh = jobs.filter(job => !prior.some(existing => existing.kind === job.kind && existing.scope === job.scope && JSON.stringify(existing.input) === JSON.stringify(job.input)));
    const raw = JSON.stringify([...prior, ...fresh]);
    await AsyncStorage.setItem(key, raw);
    try { assertRecipeScope(authority); } catch (error) {
      if (await AsyncStorage.getItem(key) === raw) await AsyncStorage.setItem(key, JSON.stringify(prior));
      throw error;
    }
  });
  return replayPantryWrites(authority, scope);
}

export function clearPendingPantry(owner: string) {
  return stored(() => AsyncStorage.removeItem(prefix + encodeURIComponent(owner)));
}

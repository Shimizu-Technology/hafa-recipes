import { useSyncExternalStore } from 'react';
import { offlineRecipes } from '@/lib/offlineRecipes';

/** Re-render scoped UI immediately when account authority is retired or restored. */
export function useOfflineLease(subject: string | null | undefined) {
  useSyncExternalStore(offlineRecipes.subscribe, offlineRecipes.version, offlineRecipes.version);
  return offlineRecipes.lease(subject);
}

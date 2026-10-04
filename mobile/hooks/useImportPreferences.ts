import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { importPreferences } from '@/lib/importPreferences';

export function useImportPreferences(ownerId: string | null) {
  const getSnapshot = useCallback(() => importPreferences.snapshot(ownerId), [ownerId]);
  const preferences = useSyncExternalStore(importPreferences.subscribe, getSnapshot);
  useEffect(() => { if (ownerId) void importPreferences.hydrate(ownerId); }, [ownerId]);
  return {
    ...preferences,
    update: useCallback(async (patch: { isPublic?: boolean; location?: string }) => {
      if (!ownerId) return;
      await importPreferences.update(ownerId, patch);
    }, [ownerId]),
  };
}

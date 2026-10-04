import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@clerk/expo';
import { importInbox, visibleImportEntries } from '@/lib/importInbox';
import { useCurrentUserIdentity } from '@/hooks/useRecipes';
import { useAsyncExtraction } from '@/contexts/ExtractionContext';

export function useImportInbox() {
  const { isSignedIn } = useAuth();
  const identity = useCurrentUserIdentity(Boolean(isSignedIn));
  const ownerId = isSignedIn ? identity.data?.id ?? null : null;
  const entries = useSyncExternalStore(importInbox.subscribe, importInbox.snapshot);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    void importInbox.hydrate().catch((error: Error) => setStorageError(error.message));
  }, []);
  return { ownerId, entries: visibleImportEntries(entries, ownerId), storageError };
}

/** One intake coordinator, independent of the screen and navigation lifecycle. */
export function useImportInboxProcessor() {
  const { ownerId, entries } = useImportInbox();
  const extraction = useAsyncExtraction();
  const submitting = useRef(false);
  const [workerVersion, setWorkerVersion] = useState(0);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  useEffect(() => {
    if (!ownerId || !extraction.requestKey || !(extraction.isExtracting || extraction.isComplete)) return;
    const recovered = entries.find((entry) => entry.ownerId === ownerId && (entry.state === 'error' || entry.state === 'submitting') &&
      extraction.requestKey === `share:${entry.id}`);
    if (recovered && (extraction.jobId || extraction.recipeId)) {
      void importInbox.patch(recovered.id, { state: 'accepted', jobId: extraction.jobId ?? undefined,
        recipeId: extraction.recipeId ?? undefined, error: undefined }).catch(() => undefined);
    }
  }, [entries, ownerId, extraction.requestKey, extraction.isExtracting, extraction.isComplete,
    extraction.jobId, extraction.recipeId]);
  useEffect(() => {
    const entry = entries.find((item) => item.ownerId === ownerId && (item.state === 'ready' || item.state === 'submitting') &&
      item.capture.kind === 'url');
    if (!ownerId || !entry || !extraction.isReady || extraction.isExtracting || extraction.canRetryStart || submitting.current) return;
    submitting.current = true;
    void (async () => {
      let persistedOutcome = false;
      try {
        // Retire the completed display only when a new job takes its place.
        if (extraction.jobId || extraction.isComplete || extraction.isFailed) await extraction.reset();
        if (ownerRef.current !== ownerId) return;
        await importInbox.patch(entry.id, { state: 'submitting', error: undefined });
        if (ownerRef.current !== ownerId) return;
        const request = entry.request ?? {
          url: entry.capture.kind === 'url' ? entry.capture.url : '',
          location: 'Guam', notes: '', is_public: false,
        };
        const result = await extraction.startExtraction(request, `share:${entry.id}`);
        await importInbox.patch(entry.id, {
          state: 'accepted', jobId: result.jobId, recipeId: result.recipeId, error: undefined,
        });
        persistedOutcome = true;
      } catch (error) {
        // The controller preserves uncertain starts with the same idempotency key.
        // An inbox error never discards the capture or silently submits it twice.
        await importInbox.patch(entry.id, {
          state: 'error', error: error instanceof Error ? error.message : 'Could not start this import.',
        }).then(() => { persistedOutcome = true; }).catch(() => undefined);
      } finally {
        submitting.current = false;
        if (persistedOutcome || ownerRef.current !== ownerId) setWorkerVersion((version) => version + 1);
      }
    })();
  }, [entries, ownerId, extraction, workerVersion]);
}

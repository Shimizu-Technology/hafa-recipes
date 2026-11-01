import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { Chip, ChipRow } from '@/components/chrome/Chips';
import { useOfflineLease } from '@/hooks/useOfflineLease';
import { offlineRecipes } from '@/lib/offlineRecipes';
import { useExtractionJobs } from '@/hooks/useRecipes';
import { useImportInbox } from '@/hooks/useImportInbox';

/**
 * Library status chips under the search row: only what needs attention (a check, imports,
 * offline copies), plus "What can I make". One scrolling row at every text size.
 */
export function LibraryStatus({ needsCheck, checking, onNeedsCheck, active }: { needsCheck: number | undefined; checking: boolean; onNeedsCheck: () => void; active: boolean }) {
  const router = useRouter();
  const { userId, isSignedIn } = useAuth();
  const lease = useOfflineLease(userId);
  const offlineVersion = useSyncExternalStore(offlineRecipes.subscribe, offlineRecipes.version, offlineRecipes.version);
  const [offlineCount, setOfflineCount] = useState(0);
  const [offlineError, setOfflineError] = useState(false);
  useEffect(() => {
    let current = true;
    setOfflineCount(0);
    setOfflineError(false);
    if (lease) void offlineRecipes.list(lease).then(rows => { if (current) setOfflineCount(rows.length); }).catch(() => { if (current) setOfflineError(true); });
    return () => { current = false; };
  }, [lease?.owner, lease?.generation, lease?.epoch, active, offlineVersion]);
  const jobs = useExtractionJobs('extract', active && Boolean(isSignedIn));
  const inbox = useImportInbox();
  const needsAttention = Boolean(isSignedIn) && (jobs.data?.some(job => ['failed', 'expired'].includes(job.status) && !job.recipe_id) || inbox.entries.some(entry => entry.state === 'error'));
  const needsReview = Boolean(isSignedIn) && inbox.entries.some(entry => entry.state === 'waiting');
  const importing = Boolean(isSignedIn) && (jobs.data?.some(job => ['queued', 'claimed', 'processing'].includes(job.status)) || inbox.entries.some(entry => ['ready', 'submitting'].includes(entry.state)));
  const importCount = (jobs.data?.filter(job => ['queued', 'claimed', 'processing'].includes(job.status)).length ?? 0)
    + inbox.entries.filter(entry => ['ready', 'submitting'].includes(entry.state)).length;
  return <ChipRow accessibilityLabel="Library status">
    {(checking || Boolean(needsCheck)) && <Chip label={needsCheck ? `Needs a check · ${needsCheck}` : 'Needs a check'} selected={checking} onPress={onNeedsCheck} icon="alert-circle-outline" />}
    {needsAttention && <Chip label="Imports need attention" tone="alert" icon="warning-outline" onPress={() => router.push('/')} accessibilityLabel="Imports need attention, view options" />}
    {!needsAttention && needsReview && <Chip label="Ready to review" icon="checkmark-circle-outline" onPress={() => router.push('/')} accessibilityLabel="Import ready to review, view options" />}
    {!needsAttention && !needsReview && importing && <Chip label={importCount > 1 ? `Importing · ${importCount}` : 'Importing'} icon="cloud-download-outline" onPress={() => router.push('/')} accessibilityLabel="Import in progress, view progress" />}
    {isSignedIn && lease && offlineCount > 0 && <Chip label={`Offline · ${offlineCount}`} icon="arrow-down-circle-outline" onPress={() => router.push('/offline-recipes')} accessibilityLabel="Offline recipes" />}
    {isSignedIn && lease && offlineError && <Chip label="Offline unavailable" tone="alert" icon="cloud-offline-outline" onPress={() => router.push('/offline-recipes')} accessibilityLabel="Offline recipes unavailable, view offline recipes" />}
    {isSignedIn && <Chip label="What can I make?" icon="basket-outline" onPress={() => router.push('/ingredient-search')} accessibilityLabel="What can I make, search by ingredient" />}
  </ChipRow>;
}

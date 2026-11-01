import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';
import { useOfflineLease } from '@/hooks/useOfflineLease';
import { offlineRecipes } from '@/lib/offlineRecipes';
import { useExtractionJobs } from '@/hooks/useRecipes';
import { useImportInbox } from '@/hooks/useImportInbox';

// Every link carries the capsule padding so selecting one never shifts the row;
// the row pulls back by the same amount so unselected text lines up with the screen margin.
const CAPSULE_INSET = 10;

export function LibraryStatus({ needsCheck, checking, onNeedsCheck, onFilter, filterCount = 0, active }: { needsCheck: number | undefined; checking: boolean; onNeedsCheck: () => void; onFilter: () => void; filterCount?: number; active: boolean }) {
  const router = useRouter();
  const colors = useColors();
  const largeText = useWindowDimensions().fontScale >= 1.3;
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
  // `selected` marks an on/off filter; it shows as a tonal capsule so the state is visible, not just announced.
  const links: { title: string; onPress: () => void; selected?: boolean }[] = [
    ...(isSignedIn ? [{ title: 'Collections', onPress: () => router.push('/collections') }] : []),
    ...(isSignedIn && lease && offlineCount ? [{ title: 'Offline', onPress: () => router.push('/offline-recipes') }] : []),
    { title: `Needs a check${needsCheck ? ` · ${needsCheck}` : ''}`, onPress: onNeedsCheck, selected: checking },
    { title: filterCount ? `Filter · ${filterCount}` : 'Filter', onPress: onFilter },
  ];
  return <View style={{ gap: 4, marginBottom: 12 }}>
    <ScrollView horizontal={!largeText} showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -CAPSULE_INSET }} contentContainerStyle={{ flexDirection: 'row', flexWrap: largeText ? 'wrap' : 'nowrap', alignItems: 'center', columnGap: 4 }}>
      {links.map(link => <Pressable key={link.title} onPress={link.onPress} accessibilityRole="button" accessibilityLabel={link.title}
        accessibilityState={link.selected === undefined ? undefined : { selected: link.selected }}
        style={{ minWidth: 44, minHeight: 44, maxWidth: '100%', flexShrink: 1, justifyContent: 'center' }}>
        <View style={{ paddingHorizontal: CAPSULE_INSET, paddingVertical: 6, borderRadius: 999, backgroundColor: link.selected ? colors.accentTint : 'transparent' }}>
          <Text style={{ fontSize: 15, lineHeight: 20, color: colors.actionText, fontWeight: link.selected ? '600' : '400' }}>{link.title}</Text>
        </View>
      </Pressable>)}
    </ScrollView>
    {(needsAttention || needsReview || importing) && <Pressable onPress={() => router.push('/')} accessibilityRole="button" accessibilityLabel={needsAttention ? 'Imports need attention, view options' : needsReview ? 'Import ready to review, view options' : 'Import in progress, view progress'} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {!needsAttention && !needsReview && <ActivityIndicator size="small" color={colors.textSecondary} />}
      <Text style={{ fontSize: 13, lineHeight: 18, color: needsAttention ? colors.error : colors.textSecondary }}>{needsAttention ? 'Imports need attention · View options' : needsReview ? 'Import ready to review' : 'Import in progress'}</Text>
    </Pressable>}
    {isSignedIn && lease && offlineError && <Pressable onPress={() => router.push('/offline-recipes')} accessibilityRole="button" accessibilityLabel="Offline recipes unavailable, view offline recipes" style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ fontSize: 13, lineHeight: 18, color: colors.error }}>Offline recipes unavailable · View options</Text></Pressable>}

  </View>;
}

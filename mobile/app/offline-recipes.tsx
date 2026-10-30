import { useEffect, useState } from 'react';
import { Alert, ScrollView, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Button, Text } from '@/components/Themed';
import { useOfflineLease } from '@/hooks/useOfflineRecipe';
import { offlineRecipes, type OfflineRecipe } from '@/lib/offlineRecipes';
export default function OfflineRecipesScreen() {
  const { userId } = useAuth();
  const router = useRouter();
  const [error, setError] = useState(false);
  const lease = useOfflineLease(userId);
  const scope = lease ? `${lease.owner}:${lease.generation}` : null;
  const [cached, setCached] = useState<{ scope: string | null; rows: OfflineRecipe[] }>({ scope: null, rows: [] });
  const rows = cached.scope === scope ? cached.rows : [];
  const setRows = (value: OfflineRecipe[]) => setCached({ scope, rows: value });
  useEffect(() => {
    let active = true;
    setError(false);
    if (lease) void offlineRecipes.list(lease).then(value => { if (active) setRows(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [userId, scope]);
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Stack.Screen options={{ title: 'Available offline' }} />
    <Text>Recently opened saved and own recipes stay on this device. Mark recipes to keep them; up to 100 kept recipes and 20 MB total. Remove copies below to free space; the latest 30 others are kept automatically. Offline copies may be out of date. Sign-out clears them.</Text>
    {error && <Text>Could not read offline recipes on this device. Reopen Håfa to try again.</Text>}
    {!error && !rows.length && <Text>Open a saved or own recipe while connected to keep an offline copy.</Text>}
    {rows.map(row => <View key={row.recipe.id}><TouchableOpacity accessibilityRole="button"
      accessibilityLabel={`Open ${row.recipe.extracted.title} offline`}
      onPress={() => router.push(`/recipe/${row.recipe.id}`)} style={{ minHeight: 44 }}>
      <Text>{row.recipe.extracted.title}{row.pinned ? ' · Available offline' : ''}</Text>
      <Text>Updated {new Date(row.savedAt).toLocaleString()}</Text>
    </TouchableOpacity><Button title={`Remove offline copy of ${row.recipe.extracted.title}`} onPress={() => {
      if (!lease) return;
      void offlineRecipes.remove(lease, row.recipe.id).then(() => offlineRecipes.list(lease)).then(setRows)
        .catch((failure: Error) => Alert.alert('Could not remove offline copy', failure.message));
    }} /></View>)}
  </ScrollView>;
}

import { useEffect, useState } from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Text } from '@/components/Themed';
import { offlineRecipes, type OfflineRecipe } from '@/lib/offlineRecipes';
export default function OfflineRecipesScreen() {
  const { userId } = useAuth();
  const router = useRouter();
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<OfflineRecipe[]>([]);
  useEffect(() => {
    let active = true;
    const lease = offlineRecipes.lease(userId);
    if (lease) void offlineRecipes.list(lease).then(value => { if (active) setRows(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [userId]);
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Stack.Screen options={{ title: 'Available offline' }} />
    <Text>Recently opened saved and own recipes stay on this device. Mark up to 20 to keep them; the latest 30 others are kept automatically. Offline copies may be out of date. Sign-out clears them.</Text>
    {error && <Text>Could not read offline recipes on this device. Reopen Håfa to try again.</Text>}
    {!error && !rows.length && <Text>Open a saved or own recipe while connected to keep an offline copy.</Text>}
    {rows.map(row => <TouchableOpacity key={row.recipe.id} accessibilityRole="button"
      accessibilityLabel={`Open ${row.recipe.extracted.title} offline`}
      onPress={() => router.push(`/recipe/${row.recipe.id}`)} style={{ minHeight: 44 }}>
      <Text>{row.recipe.extracted.title}{row.pinned ? ' · Available offline' : ''}</Text>
      <Text>Updated {new Date(row.savedAt).toLocaleString()}</Text>
    </TouchableOpacity>)}
  </ScrollView>;
}

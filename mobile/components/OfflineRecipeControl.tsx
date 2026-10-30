import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { Button, Text } from '@/components/Themed';
import { offlineRecipes, type OfflineRecipe } from '@/lib/offlineRecipes';

export function OfflineRecipeControl({ recipeId, eligible }: { recipeId: string; eligible: boolean }) {
  const { userId } = useAuth();
  const lease = offlineRecipes.lease(userId);
  const scope = lease ? `${lease.owner}:${lease.generation}` : null;
  const [row, setRow] = useState<OfflineRecipe | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!lease) { setRow(null); return; }
    void offlineRecipes.read(lease, recipeId).then(value => { if (active) setRow(value); }).catch(() => { if (active) setRow(null); });
    return () => { active = false; };
  }, [scope, recipeId, eligible]);
  if (!lease || (!eligible && !row)) return null;
  return <View style={{ gap: 8, paddingVertical: 8 }}>
    {row && <Text>Offline copy · Updated {new Date(row.savedAt).toLocaleString()}. Changes may be missing while offline.</Text>}
    <Button title={row?.pinned ? 'Available offline ✓' : 'Make available offline'} disabled={busy}
      onPress={() => {
        setBusy(true);
        void offlineRecipes.pin(lease, recipeId, !row?.pinned).then(() => offlineRecipes.read(lease, recipeId))
          .then(setRow).catch((error: Error) => Alert.alert('Could not update offline recipe', error.message))
          .finally(() => setBusy(false));
      }} />
  </View>;
}

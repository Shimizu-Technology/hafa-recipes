import { api } from '@/lib/api';
import { CaptureAccountChangedError } from '@/lib/captureAccount';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { Button, Text } from '@/components/Themed';
import { useOfflineLease } from '@/hooks/useOfflineLease';
import { offlineRecipes, type OfflineRecipe } from '@/lib/offlineRecipes';

export function OfflineRecipeControl({ recipeId, eligible }: { recipeId: string; eligible: boolean }) {
  const { userId } = useAuth();
  const lease = useOfflineLease(userId);
  const scope = lease ? `${lease.owner}:${lease.generation}` : null;
  const [cached, setCached] = useState<{ scope: string | null; row: OfflineRecipe | null }>({ scope: null, row: null });
  const [busy, setBusy] = useState(false);
  const row = cached.scope === scope ? cached.row : null;
  const setRow = (value: OfflineRecipe | null) => setCached({ scope, row: value });
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
        const current = () => { const authority = offlineRecipes.lease(userId); return authority?.owner === lease.owner && authority.generation === lease.generation && authority.epoch === lease.epoch; };
        if (!current()) return;
        setBusy(true);
        void (async () => {
          if (!row) await api.getRecipe(recipeId, undefined, () => { if (!current()) throw new CaptureAccountChangedError(); });
          if (!current()) return;
          await offlineRecipes.pin(lease, recipeId, !row?.pinned);
          const value = await offlineRecipes.read(lease, recipeId);
          if (current()) setRow(value);
        })().catch((error: Error) => { if (current()) Alert.alert('Could not update offline recipe', error.message); })
          .finally(() => { if (current()) setBusy(false); });
      }} />
  </View>;
}

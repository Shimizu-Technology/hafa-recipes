import { api } from '@/lib/api';
import { CaptureAccountChangedError } from '@/lib/captureAccount';
import { useEffect, useState } from 'react';
import { Alert, View, Switch } from 'react-native';
import { useAuth } from '@clerk/expo';
import { RecipeDetailRow } from './RecipeDetailRow';
import { Text, useColors } from '@/components/Themed';
import { useOfflineLease } from '@/hooks/useOfflineLease';
import { offlineRecipes, type OfflineRecipe } from '@/lib/offlineRecipes';

export function OfflineRecipeControl({ recipeId, eligible }: { recipeId: string; eligible: boolean }) {
  const colors = useColors();
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
  return <View>
    <RecipeDetailRow icon="cloud-download-outline" title="Available offline" accessory={<Switch accessibilityLabel="Available offline" value={Boolean(row?.pinned)} disabled={busy}
      onValueChange={() => {
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
      }} />} />
    {row?.pinned && <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingBottom: 12, fontSize: 13, lineHeight: 18 }}>Offline copy · Updated {new Date(row.savedAt).toLocaleString()}. Changes may be missing while offline.</Text>}
  </View>;
}

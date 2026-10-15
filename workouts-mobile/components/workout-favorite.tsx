import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Notice } from "@/components/ui";
import { useTraining } from "@/lib/context";
import type { Workout } from "@/lib/models";
import type { Organization } from "@/lib/organization";

export function WorkoutFavorite({ workout }: { workout: Workout }) {
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const scope = useMemo(() => ({ lock: null as object | null }), [owner, enrollment?.generation, storage, workout.id]);
  const live = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    live.current = scope; setError(""); setBusy(false);
    return () => { if (live.current === scope) live.current = null; };
  }, [scope]);
  function current() { return live.current === scope && storage.isCurrent() && isCurrentAccount(); }
  async function toggle() {
    if (scope.lock || !current() || workout.generation !== enrollment?.generation) return;
    const token = {}; scope.lock = token; setBusy(true); setError("");
    const favorite = !workout.organization?.favorite;
    try {
      const latest = await api.organization(workout.id, workout.generation);
      if (!current()) return;
      const saved = latest.favorite === favorite ? latest : await api.saveOrganization(workout.id,
        { expected_revision: latest.revision, favorite }, workout.generation);
      if (!current()) return;
      cache.setQueryData<Organization>([owner, "organization", workout.id, workout.generation], old =>
        old && old.revision > saved.revision ? old : saved);
      cache.setQueryData<Workout>([owner, "workout", workout.id, workout.generation], old =>
        old && (old.organization?.revision ?? 0) <= saved.revision ? { ...old, organization: saved } : old);
      void cache.invalidateQueries({ queryKey: [owner, "library"] });
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : "Could not change this favorite. Try again.");
    } finally { if (scope.lock === token) scope.lock = null; if (current()) setBusy(false); }
  }
  return <View style={{ flex: 1, minWidth: 160, gap: 8 }}>
    <Button title={workout.organization?.favorite ? "Remove favorite" : "Favorite workout"}
      icon={workout.organization?.favorite ? "heart" : "heart-outline"} secondary size="sm" inline busy={busy} onPress={() => void toggle()} />
    {!!error && <Notice error>{error}</Notice>}
  </View>;
}

import { useEffect, useRef, useState } from "react";
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
  const lock = useRef<object | null>(null), mounted = useRef(true);
  const scope = `${owner}:${enrollment?.generation}:${workout.id}`;
  const live = useRef(scope); live.current = scope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { lock.current = null; setError(""); setBusy(false); }, [scope]);
  function current() { return mounted.current && live.current === scope && storage.isCurrent() && isCurrentAccount(); }
  async function toggle() {
    if (lock.current || !current() || workout.generation !== enrollment?.generation) return;
    const token = {}; lock.current = token; setBusy(true); setError("");
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
    } finally { if (lock.current === token) lock.current = null; if (current()) setBusy(false); }
  }
  return <View style={{ flex: 1, minWidth: 160, gap: 8 }}>
    <Button title={workout.organization?.favorite ? "Remove favorite" : "Favorite workout"}
      icon={workout.organization?.favorite ? "heart" : "heart-outline"} secondary size="sm" inline busy={busy} onPress={() => void toggle()} />
    {!!error && <Notice error>{error}</Notice>}
  </View>;
}

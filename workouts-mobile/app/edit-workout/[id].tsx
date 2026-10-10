import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Notice, Screen } from "@/components/ui";
import { WorkoutEditor } from "@/components/workout-editor";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { editedContent, workoutErrors } from "@/lib/library";
import type { Workout, AuthoredWorkout } from "@/lib/models";
export default function EditWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { localDrafts, api, owner, enrollment } = useTraining();
  const scope = `workout-edit:${enrollment?.generation}:${id}`;
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "workout", id, enrollment?.generation],
    queryFn: () => api.workout(id),
    enabled: !!enrollment?.enrolled,
  });
  const [value, setValue] = useState<Workout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void localDrafts
      .load<Workout>(owner, scope)
      .then((draft) => {
        if (active) setValue(draft ?? q.data ?? null);
      })
      .catch(() => {
        if (active) {
          setValue(q.data ?? null);
          setError("Could not restore your edit draft. The saved workout is shown.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, scope, q.data]);
  function update(content: AuthoredWorkout) {
    if (!value) return;
    const next = { ...value, ...content };
    setValue(next);
    void localDrafts
      .save(owner, scope, next)
      .catch(() => setError("Could not keep these corrections on your device. Stay here until saved."));
  }
  async function save() {
    if (!value) return;
    const content = editedContent(value);
    const errors = workoutErrors(content, true);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setBusy(true);
    try {
      const saved = await api.updateWorkout({ ...value, ...content });
      await localDrafts.remove(owner, scope);
      cache.setQueryData([owner, "workout", id, enrollment?.generation], saved);
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      router.replace({ pathname: "/workout/[id]", params: { id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      title="Make the details clear."
      subtitle="An edit creates a new workout version. Completed sessions keep their original prescription."
    >
      <QueryState
        loading={q.isPending && !value}
        error={value ? null : q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {value && (
          <>
            <WorkoutEditor value={editedContent(value)} onChange={update} />
            <Button
              title="Save new workout version"
              busy={busy}
              onPress={() => {
                void save();
              }}
            />
          </>
        )}
      </QueryState>
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}

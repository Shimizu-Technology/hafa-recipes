import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Notice, Screen } from "@/components/ui";
import { createPrivateForm } from "@/lib/private-form";
import { WorkoutEditor } from "@/components/workout-editor";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { editedContent, workoutErrors } from "@/lib/library";
import type { Workout, AuthoredWorkout } from "@/lib/models";
export default function EditWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { storage, api, owner, enrollment, isCurrentAccount } = useTraining();
  const scope = `workout-edit:${enrollment?.generation}:${id}`;
  const cache = useQueryClient();
  const form = useMemo(() => createPrivateForm<Workout, Workout>(storage, owner, scope), [storage, owner, scope]);
  const [loaded, setLoaded] = useState(false);
  const [command, setCommand] = useState<Workout | null>(null);
  const [resolved, setResolved] = useState(false);
  const sealed = useRef(false);
  sealed.current = !!command || resolved;
  const mounted = useRef(true);
  const live = useRef(scope);
  live.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function current() {
    if (!mounted.current || live.current !== scope || !storage.isCurrent() || !isCurrentAccount())
      throw Error("Your account or training setup changed. This workout edit was stopped.");
  }
  const q = useQuery({
    queryKey: [owner, "workout", id, enrollment?.generation],
    queryFn: () => api.workout(id),
    enabled: !!enrollment?.enrolled
  });
  const lock = useRef(false);
  const [value, setValue] = useState<Workout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setValue(null);
    setCommand(null);
    setResolved(false);
    void form
      .load()
      .then((box) => {
        if (active) {
          if (box.input?.id === id) setValue(box.input);
          setCommand(box.command);
          setResolved(box.terminal);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setLoaded(true);
          setError("Could not restore your edit draft. Inspect saved data before changing it.");
        }
      });
    return () => {
      active = false;
    };
  }, [form, id]);
  useEffect(() => {
    if (loaded && !value && !command && q.data) setValue(q.data);
  }, [loaded, value, command, resolved, q.data]);
  function update(content: AuthoredWorkout) {
    if (!value || lock.current || sealed.current) return;
    try {
      current();
    } catch {
      return;
    }
    const next = { ...value, ...content };
    setValue(next);
    void form
      .save(next)
      .catch(() => setError("Could not keep these corrections on your device. Stay here until saved."));
  }
  async function reloadSaved() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      current();
      const fresh = await api.workout(id);
      current();
      await form.reset();
      await form.save(fresh);
      current();
      setValue(fresh);
      setCommand(null);
      setResolved(false);
      setError("");
      cache.setQueryData([owner, "workout", id, enrollment?.generation], fresh);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (!value || value.id !== id || lock.current || resolved) return;
    const content = command ? editedContent(command) : editedContent(value);
    const errors = workoutErrors(content, true);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      current();
      const frozen = await form.begin(value, command ?? { ...value, ...content });
      current();
      setCommand(frozen);
      const saved = await api.updateWorkout(frozen);
      current();
      await form.complete(frozen, saved.id);
      current();
      setResolved(true);
      setCommand(null);
      cache.setQueryData([owner, "workout", id, enrollment?.generation], saved);
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      current();
      router.replace({ pathname: "/workout/[id]", params: { id } });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen
      back
      title="Make the details clear."
      subtitle="An edit creates a new workout version. Completed sessions keep their original prescription."
    >
      <QueryState
        loading={!loaded || (q.isPending && !value)}
        error={value ? null : q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {value && (
          <>
            <View pointerEvents={busy ? "none" : "auto"}>
              <WorkoutEditor value={editedContent(value)} onChange={update} disabled={busy || !!command || resolved} />
            </View>
            <Button
              title={command ? "Retry saving changes" : "Save new workout version"}
              disabled={resolved}
              busy={busy}
              onPress={() => {
                void save();
              }}
            />
          </>
        )}
      </QueryState>
      {command && (
        <Notice>
          These workout changes are saved on this device. Retry sends the same details. If you did not receive a save
          confirmation, reload the saved workout before discarding this draft.
        </Notice>
      )}
      {(command || resolved) && (
        <Button
          title="Reload saved workout and discard this draft"
          secondary
          busy={busy}
          onPress={() => {
            void reloadSaved();
          }}
        />
      )}
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}

import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Field, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { createPrivateForm } from "@/lib/private-form";
import type { AuthoredWorkout } from "@/lib/models";
import { blankWorkout, manualWorkout, type WorkoutDraft } from "@/lib/manual";
interface Command {
  key: string;
  generation: number;
  workout: AuthoredWorkout;
}
export default function AddWorkout() {
  const { storage, api, owner, enrollment, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const guard = useRef(false);
  const draftScope = `manual-workout:${enrollment?.generation ?? "none"}`;
  const form = useMemo(
    () => createPrivateForm<WorkoutDraft, Command>(storage, owner, draftScope),
    [storage, owner, draftScope]
  );
  const creationKey = useRef(Crypto.randomUUID());
  const [command, setCommand] = useState<Command | null>(null);
  const [resolved, setResolved] = useState(false);
  const sealed = useRef(false);
  sealed.current = !!command || resolved;
  const [abandon, setAbandon] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function current() {
    if (!mounted.current || !storage.isCurrent() || !isCurrentAccount())
      throw Error("Your account or training setup changed. This workout save was stopped.");
  }
  const [draft, setDraft] = useState(blankWorkout);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void form
      .load()
      .then((box) => {
        if (active) {
          if (box.input) {
            setDraft(box.input);
            if (box.input.creation_key) creationKey.current = box.input.creation_key;
          }
          setCommand(box.command);
          setResolved(box.terminal);
          setSavedId(box.saved_id ?? null);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setLoaded(true);
          setError("Could not restore your draft. You can enter the workout again.");
        }
      });
    return () => {
      active = false;
    };
  }, [form]);
  function update(value: WorkoutDraft) {
    if (guard.current || sealed.current) return;
    try {
      current();
    } catch {
      return;
    }
    setDraft(value);
    void form
      .save({ ...value, creation_key: creationKey.current, generation: enrollment?.generation ?? undefined })
      .catch(() => setError("Could not keep this draft locally. Stay here until saved."));
  }
  async function save() {
    if (guard.current || !loaded || resolved) return;
    let workout;
    try {
      workout = command?.workout ?? manualWorkout(draft);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      current();
      const pending = command ?? { key: creationKey.current, generation: enrollment?.generation ?? 0, workout };
      const frozen = await form.begin(draft, pending);
      current();
      setCommand(frozen);
      const saved = await api.saveWorkout(frozen.workout, frozen.key, frozen.generation);
      current();
      await form.complete(frozen, saved.id);
      setResolved(true);
      setCommand(null);
      setSavedId(saved.id);
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      current();
      router.replace({ pathname: "/workout/[id]", params: { id: saved.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the workout. Your local draft is safe.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen back title="Keep a good workout." subtitle="Write your session once. Make it easy to use again.">
      <Notice>
        Your draft is private and saved on this device. Sets and reps can stay blank when you do not know them.
      </Notice>
      {!loaded ? (
        <Copy>Loading your draft…</Copy>
      ) : resolved ? (
        <Notice>Your workout was saved. Open it or start another draft.</Notice>
      ) : (
        <>
          <Field
            disabled={busy || !!command}
            label="Workout name"
            value={draft.title}
            onChange={(title) => update({ ...draft, title })}
            placeholder="My full-body session"
          />
          <Field
            disabled={busy || !!command}
            label="Equipment"
            optional
            value={draft.equipment}
            onChange={(equipment) => update({ ...draft, equipment })}
            placeholder="Dumbbells, bench"
          />
          {draft.exercises.map((exercise, index) => (
            <Card key={index}>
              <Copy kind="label">EXERCISE {index + 1}</Copy>
              <Field
                disabled={busy || !!command}
                label="Exercise name"
                value={exercise.name}
                onChange={(name) =>
                  update({ ...draft, exercises: draft.exercises.map((e, i) => (i === index ? { ...e, name } : e)) })
                }
                placeholder="Goblet squat"
              />
              <Field
                disabled={busy || !!command}
                label="Sets"
                optional
                numeric
                value={exercise.sets}
                onChange={(sets) =>
                  update({ ...draft, exercises: draft.exercises.map((e, i) => (i === index ? { ...e, sets } : e)) })
                }
              />
              <Field
                disabled={busy || !!command}
                label="Reps per set"
                optional
                numeric
                value={exercise.reps}
                onChange={(reps) =>
                  update({ ...draft, exercises: draft.exercises.map((e, i) => (i === index ? { ...e, reps } : e)) })
                }
              />
              {draft.exercises.length > 1 && (
                <Button
                  disabled={busy || !!command}
                  title={`Remove exercise ${index + 1}`}
                  secondary
                  onPress={() => update({ ...draft, exercises: draft.exercises.filter((_, i) => i !== index) })}
                />
              )}
            </Card>
          ))}
          <Button
            disabled={busy || !!command}
            title="Add another exercise"
            secondary
            icon="add"
            onPress={() => update({ ...draft, exercises: [...draft.exercises, { name: "", sets: "", reps: "" }] })}
          />
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
      {command && (
        <Notice>
          These workout details are saved on this device. Retry sends the same details to avoid a duplicate.
        </Notice>
      )}
      {savedId && (
        <Button
          title="Open saved workout"
          secondary
          onPress={() => router.push({ pathname: "/workout/[id]", params: { id: savedId } })}
        />
      )}
      {(command || resolved) && (
        <Button title="Start another workout" secondary disabled={busy} onPress={() => setAbandon(true)} />
      )}
      {abandon && (
        <Card>
          <Notice>
            This workout may already be in your library. Check there first if you did not receive a save confirmation.
            Starting another workout discards this device draft and does not remove any saved workout.
          </Notice>
          <Button title="Open my library" secondary disabled={busy} onPress={() => router.push("/(tabs)/library")} />
          <Button
            title="Start another workout and discard this draft"
            secondary
            disabled={busy}
            onPress={() => {
              if (guard.current) return;
              guard.current = true;
              setBusy(true);
              void (async () => {
                current();
                await form.reset();
                current();
                creationKey.current = Crypto.randomUUID();
                setDraft(blankWorkout());
                setCommand(null);
                setResolved(false);
                setSavedId(null);
                setError("");
                setAbandon(false);
              })()
                .catch((e) => {
                  if (mounted.current) setError(e.message);
                })
                .finally(() => {
                  guard.current = false;
                  if (mounted.current) setBusy(false);
                });
            }}
          />
          <Button title="Keep this draft" secondary disabled={busy} onPress={() => setAbandon(false)} />
        </Card>
      )}
      <Button
        title={command ? "Retry saving workout" : "Save to my library"}
        busy={busy}
        disabled={!loaded || resolved}
        onPress={() => {
          void save();
        }}
      />
    </Screen>
  );
}

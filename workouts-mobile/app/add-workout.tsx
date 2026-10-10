import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Field, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { blankWorkout, manualWorkout, type WorkoutDraft } from "@/lib/manual";
export default function AddWorkout() {
  const { localDrafts, api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const guard = useRef(false);
  const draftScope = `manual-workout:${enrollment?.generation ?? "none"}`;
  const creationKey = useRef(Crypto.randomUUID());
  const [draft, setDraft] = useState(blankWorkout);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void localDrafts
      .load<WorkoutDraft>(owner, draftScope)
      .then((value) => {
        if (active) {
          if (value) {
            setDraft(value);
            if (value.creation_key) creationKey.current = value.creation_key;
          }
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
  }, [owner, draftScope]);
  function update(value: WorkoutDraft) {
    setDraft(value);
    void localDrafts
      .save(owner, draftScope, { ...value, creation_key: creationKey.current, generation: enrollment?.generation })
      .catch(() => setError("Could not keep this draft locally. Stay here until saved."));
  }
  async function save() {
    if (guard.current) return;
    let workout;
    try {
      workout = manualWorkout(draft);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveWorkout(workout, creationKey.current, enrollment?.generation ?? undefined);
      await localDrafts.remove(owner, draftScope);
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
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
      ) : (
        <>
          <Field
            label="Workout name"
            value={draft.title}
            onChange={(title) => update({ ...draft, title })}
            placeholder="My full-body session"
          />
          <Field
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
                label="Exercise name"
                value={exercise.name}
                onChange={(name) =>
                  update({ ...draft, exercises: draft.exercises.map((e, i) => (i === index ? { ...e, name } : e)) })
                }
                placeholder="Goblet squat"
              />
              <Field
                label="Sets"
                optional
                numeric
                value={exercise.sets}
                onChange={(sets) =>
                  update({ ...draft, exercises: draft.exercises.map((e, i) => (i === index ? { ...e, sets } : e)) })
                }
              />
              <Field
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
                  title={`Remove exercise ${index + 1}`}
                  secondary
                  onPress={() => update({ ...draft, exercises: draft.exercises.filter((_, i) => i !== index) })}
                />
              )}
            </Card>
          ))}
          <Button
            title="Add another exercise"
            secondary
            icon="add"
            onPress={() => update({ ...draft, exercises: [...draft.exercises, { name: "", sets: "", reps: "" }] })}
          />
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
      <Button
        title="Save to my library"
        busy={busy}
        disabled={!loaded}
        onPress={() => {
          void save();
        }}
      />
    </Screen>
  );
}

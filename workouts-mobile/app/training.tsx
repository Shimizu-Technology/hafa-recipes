import { useReminders } from "@/components/reminders-provider";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import { router } from "expo-router";
import { Button, Card, Choice, Copy, Empty, Field, Notice, Screen, useColors } from "@/components/ui";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { remainingSeconds, summaryOf, previousActual, actualIdentity, draftStructureWarning } from "@/lib/training";
import type { ActualSet } from "@/lib/models";
export default function Training() {
  const { api, units, owner, enrollment } = useTraining();
  const { store, state, ready, error: restoreError, retry } = useOfflineTraining();
  const past = useQuery({
    queryKey: [owner, "sessions", enrollment?.generation],
    queryFn: api.sessions,
    enabled: !!enrollment?.enrolled,
  });
  const c = useColors();
  const d = state.active;
  const reminders = useReminders();
  const [now, setNow] = useState(Date.now());
  const [input, setInput] = useState<Record<string, string>>({});
  const inputRef = useRef(input);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [advanced, setAdvanced] = useState(false);
  const [metric, setMetric] = useState<"reps" | "time" | "distance">("reps");
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const restored = d?.input ?? {};
    setInput(restored);
    inputRef.current = restored;
  }, [d?.id, d?.cursor]);
  useEffect(() => {
    const exercise = d?.steps[d.cursor]?.exercise;
    setMetric(exercise?.duration_seconds != null ? "time" : exercise?.distance_meters != null ? "distance" : "reps");
    setAdvanced(false);
  }, [d?.id, d?.cursor]);
  function field(key: string, value: string) {
    const next = { ...inputRef.current, [key]: value };
    inputRef.current = next;
    setInput(next);
    void store
      ?.input(next)
      .catch(() => setError("Could not save your current inputs locally. Keep this screen open and retry."));
  }
  async function run(work: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save on this device.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  if (restoreError)
    return (
      <Screen back title="Restore your session.">
        <Notice error>{restoreError}</Notice>
        <Button title="Try restoring again" onPress={retry} />
      </Screen>
    );
  if (!ready)
    return (
      <Screen back title="Restore your training.">
        <Copy>Loading your saved session…</Copy>
      </Screen>
    );
  if (!d || !store)
    return (
      <Screen back title="Ready when you are.">
        <Empty
          icon="fitness-outline"
          title="No active session"
          description="Choose a saved workout or scheduled session to start training."
          action={<Button title="Open library" onPress={() => router.replace("/(tabs)/library")} />}
        />
      </Screen>
    );
  const structureWarning = draftStructureWarning(d);
  const step = d.steps[d.cursor];
  const e = step?.exercise;
  const unit =
    input.load_unit === "kg" || input.load_unit === "lb" ? input.load_unit : units === "imperial" ? "lb" : "kg";
  const previous = step
    ? previousActual(d.workout, step, [
        ...state.history.map((h) => ({ workout: h.workout, actuals: h.request.actuals })),
        ...(past.data ?? []).map((h) => ({ workout: h.content.prescription_snapshot, actuals: h.content.actuals })),
      ])
    : null;
  const rest = remainingSeconds(d.rest_until, now);
  const interval = d.interval_started_at == null ? 0 : Math.max(0, Math.floor((now - d.interval_started_at) / 1000));
  async function log(completed: boolean) {
    if (!step || !store) return;
    const optional = (key: string) => (inputRef.current[key]?.trim() ? Number(inputRef.current[key]) : null);
    const load = optional("load");
    const distance = optional("distance");
    const actual: ActualSet = {
      block_id: step.block_id,
      exercise_index: step.exercise_index,
      set_index: step.set_index,
      round_index: step.round_index,
      side: step.side,
      completed,
      reps: optional("reps"),
      duration_seconds: optional("seconds"),
      distance_meters: distance == null ? null : units === "imperial" ? distance * 1609.344 : distance,
      load,
      load_unit: load == null ? null : unit,
      load_convention: load == null ? null : (inputRef.current.convention as ActualSet["load_convention"]) || null,
      difficulty: (inputRef.current.difficulty as ActualSet["difficulty"]) || null,
      effort: optional("effort"),
      pain_reported: inputRef.current.pain === "yes" ? true : inputRef.current.pain === "no" ? false : null,
      notes: inputRef.current.notes || null,
    };
    await store.log(actual);
  }
  async function finish(status: "completed" | "partial") {
    await store!.finish(status);
    void store!.sync(api.saveSession);
    router.replace("/(tabs)/progress");
  }
  return (
    <Screen
      back
      title={d.workout.title}
      subtitle={`${d.actuals.filter((a) => a.completed).length} ${d.actuals.filter((a) => a.completed).length === 1 ? "set" : "sets"} recorded · saved on this device`}
    >
      {!!structureWarning && (
        <>
          <Notice error>{structureWarning}</Notice>
          {!d.actuals.length && (
            <Button
              title="Review empty draft with current set numbering"
              secondary
              disabled={busy}
              onPress={() => { void run(() => store.reviewEmptyDraft()); }}
            />
          )}
        </>
      )}
      {d.paused && (
        <Notice>
          Your session is paused. Restored sessions resume from the last saved checkpoint; time away is not counted as
          active training.
        </Notice>
      )}
      {rest > 0 && (
        <Card tone="hero">
          <Copy kind="label" color="#DDEBCB">
            REST
          </Copy>
          <Copy kind="title" color="#FFFFFF">
            {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, "0")}
          </Copy>
          <Button
            title="End rest"
            secondary
            onPress={() => {
              void run(() => store.timer("rest", 0));
            }}
          />
        </Card>
      )}
      {step && e ? (
        <>
          <Card>
            <Copy kind="small" color={c.muted}>
              {step.block_label} · {step.grouping} · round {step.round_index} · set {step.target_set}
              {step.side ? ` · ${step.side} side` : ""}
            </Copy>
            <Copy kind="title">{e.name}</Copy>
            {previous && <Notice>Previous recorded set · {summaryOf(previous)}</Notice>}
            <Copy>
              {e.reps_min != null
                ? `${e.reps_min}${e.reps_max != null && e.reps_max !== e.reps_min ? `–${e.reps_max}` : ""} reps${e.per_side ? " each side" : ""}`
                : "Reps not specified"}
              {e.duration_seconds != null ? ` · ${e.duration_seconds}s` : ""}
              {e.distance_meters != null ? ` · ${e.distance_meters}m` : ""}
            </Copy>
            {e.sets == null && (
              <Notice>
                The source does not specify sets. Log what you do; add another set if you choose additional work.
              </Notice>
            )}
            {e.load != null && (
              <Copy>
                Source load · {e.load} {e.load_unit} · {e.load_convention?.replaceAll("_", " ")}
              </Copy>
            )}
            {!!e.tempo && <Copy>Tempo · {e.tempo}</Copy>}
            {!!e.effort && <Copy>Source effort · {e.effort}</Copy>}
            {!!e.notes && <Copy>{e.notes}</Copy>}
            {!!d.workout.source_url && (
              <Button
                title="Open original instructions"
                secondary
                onPress={() => {
                  void Linking.openURL(d.workout.source_url!).catch(() =>
                    setError("Could not open the source. Your session remains saved.")
                  );
                }}
              />
            )}
          </Card>
          <Copy kind="heading">What you actually did</Copy>
          <Choice label="Log reps" selected={metric === "reps"} onPress={() => setMetric("reps")} />
          <Choice label="Log time" selected={metric === "time"} onPress={() => setMetric("time")} />
          <Choice label="Log distance" selected={metric === "distance"} onPress={() => setMetric("distance")} />
          {metric === "reps" && (
            <Field label="Actual reps" optional numeric value={input.reps ?? ""} onChange={(v) => field("reps", v)} />
          )}
          {metric === "time" && (
            <>
              <Field
                label="Actual time · seconds"
                optional
                numeric
                value={input.seconds ?? ""}
                onChange={(v) => field("seconds", v)}
              />
              {d.interval_started_at != null ? (
                <>
                  <Copy kind="heading">Interval timer · {interval}s</Copy>
                  <Button
                    title="Use elapsed seconds and stop timer"
                    secondary
                    disabled={d.paused || !!structureWarning}
                    onPress={() => {
                      field("seconds", String(interval));
                      void run(() => store.timer("interval", 0));
                    }}
                  />
                </>
              ) : (
                <Button
                  title="Start interval timer"
                  secondary
                  disabled={d.paused || !!structureWarning}
                  onPress={() => {
                    void run(() => store.timer("interval"));
                  }}
                />
              )}
            </>
          )}
          {metric === "distance" && (
            <Field
              label={`Actual distance · ${units === "imperial" ? "miles" : "metres"}`}
              optional
              numeric
              value={input.distance ?? ""}
              onChange={(v) => field("distance", v)}
            />
          )}
          <Button
            title={advanced ? "Hide load and feedback" : "Add load or feedback"}
            secondary
            onPress={() => setAdvanced(!advanced)}
          />
          {advanced && (
            <>
              <Field
                label={`Actual load · ${unit}`}
                optional
                numeric
                value={input.load ?? ""}
                onChange={(v) => field("load", v)}
              />
              <Choice label="Record load in kg" selected={unit === "kg"} onPress={() => field("load_unit", "kg")} />
              <Choice label="Record load in lb" selected={unit === "lb"} onPress={() => field("load_unit", "lb")} />
              {!!input.load?.trim() && (
                <>
                  <Copy kind="label">How is that load measured?</Copy>
                  {(["total", "per_hand", "added", "assistance"] as const).map((value) => (
                    <Choice
                      key={value}
                      label={
                        {
                          total: "Total external load",
                          per_hand: "Per hand",
                          added: "Added to bodyweight",
                          assistance: "Assistance weight",
                        }[value]
                      }
                      selected={input.convention === value}
                      onPress={() => field("convention", value)}
                    />
                  ))}
                </>
              )}
              <Field
                label="Effort · 0 to 10"
                optional
                numeric
                value={input.effort ?? ""}
                onChange={(v) => field("effort", v)}
              />
              <Copy kind="small" color={c.muted}>
                0 = no effort · 10 = maximum effort. Leave blank if you prefer.
              </Copy>
              <Copy kind="label">How did the set feel?</Copy>
              {(["easy", "manageable", "hard"] as const).map((value) => (
                <Choice
                  key={value}
                  label={value}
                  selected={input.difficulty === value}
                  onPress={() => field("difficulty", input.difficulty === value ? "" : value)}
                />
              ))}
              <Copy kind="label">Any pain during this set?</Copy>
              {(["yes", "no"] as const).map((value) => (
                <Choice
                  key={value}
                  label={value === "yes" ? "Yes, pain reported" : "No pain reported"}
                  selected={input.pain === value}
                  onPress={() => field("pain", input.pain === value ? "" : value)}
                />
              ))}
              {input.pain === "yes" && (
                <Notice>
                  Stop any movement that causes pain. Save a partial session if needed, and follow your professional
                  guidance.
                </Notice>
              )}
              <Field
                label="Set notes"
                optional
                multiline
                value={input.notes ?? ""}
                onChange={(v) => field("notes", v)}
              />
            </>
          )}
          <Button
            title={step.side ? `Log ${step.side} side` : "Log this set"}
            busy={busy}
            disabled={d.paused || !!structureWarning}
            onPress={() => {
              void run(() => log(true));
            }}
          />
          <Button
            title="Skip this set"
            secondary
            disabled={busy || d.paused || !!structureWarning}
            onPress={() => {
              void run(() => log(false));
            }}
          />
          <Button
            title="Add another set of this exercise"
            secondary
            disabled={busy || !!structureWarning}
            onPress={() => {
              void run(() => store.addSet());
            }}
          />
        </>
      ) : (
        <Empty
          icon="checkmark-circle-outline"
          title="You've reached the end"
          description="Review your recorded work below, then save the session. Skipped sets stay visible as partial training."
        />
      )}
      {!!reminders.state.error && (
        <Notice>Optional rest alert could not be updated. The in-app timer still works. {reminders.state.error}</Notice>
      )}
      {reminders.state.settings.rest_enabled && reminders.state.permission !== "granted" && (
        <Notice>Device rest alerts are unavailable or not permitted. Your in-app timer still works.</Notice>
      )}
      {!!error && <Notice error>{error}</Notice>}
      {!!d.actuals.length && (
        <Card>
          <Copy kind="heading">Recorded work</Copy>
          {d.actuals.map((a) => (
            <Copy key={actualIdentity(a)}>
              {d.workout.blocks.find((b) => b.id === a.block_id)?.exercises[a.exercise_index]?.name} ·{" "}
              {a.completed ? summaryOf(a) : "Skipped"}
            </Copy>
          ))}
          <Button
            title="Undo last set"
            secondary
            disabled={busy}
            onPress={() => {
              void run(() => store.undo());
            }}
          />
        </Card>
      )}
      <Copy kind="heading">Activity type</Copy>
      {(["general_fitness", "strength_training", "running", "walking", "basketball"] as const).map((type) => (
        <Choice
          key={type}
          label={type.replaceAll("_", " ")}
          selected={d.activity_type === type}
          onPress={() => {
            void run(() => store.activityType(type));
          }}
        />
      ))}
      <Button
        title={d.paused ? "Resume session" : "Pause session"}
        secondary
        disabled={busy}
        onPress={() => {
          void run(() => store.pause(!d.paused));
        }}
      />
      {!structureWarning && d.cursor === d.steps.length && !d.actuals.some((a) => !a.completed) && (
        <Button
          title="Finish and save session"
          busy={busy}
          onPress={() => {
            void run(() => finish("completed"));
          }}
        />
      )}
      <Button
        title="Finish as partial session"
        secondary
        disabled={busy || !d.actuals.length}
        onPress={() => {
          void run(() => finish("partial"));
        }}
      />
      <Button
        title="Discard this session"
        secondary
        disabled={busy}
        onPress={() =>
          Alert.alert("Discard this session?", "Recorded sets and unsaved notes will be removed from this device.", [
            { text: "Keep training", style: "cancel" },
            {
              text: "Discard",
              style: "destructive",
              onPress: () => {
                void run(async () => {
                  await store.discard();
                  router.replace("/(tabs)");
                });
              },
            },
          ])
        }
      />
    </Screen>
  );
}

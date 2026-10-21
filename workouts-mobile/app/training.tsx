import { WorkoutInstructions } from "@/components/workout-instructions";
import { useReminders } from "@/components/reminders-provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Keyboard, Linking } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Card,
  Chip,
  ChipRow,
  Copy,
  Empty,
  Field,
  IconButton,
  ListRow,
  Notice,
  RestTimer,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  SetRow,
  Sheet,
  StatTile,
  formatClock,
  haptics,
} from "@/components/ui";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { sessionsQuery, sessionReadStartedAt } from "@/lib/session-query";
import { effectiveTrainingHistory } from "@/lib/progress-selection";
import { remainingSeconds, summaryOf, previousActual, actualIdentity, draftStructureWarning, hasUnloggedInput } from "@/lib/training";
import type { ActualSet } from "@/lib/models";
import { circuitRemaining, completedCircuitRounds } from "@/lib/timed-circuit";
import { NumberStepper } from "@/components/training/number-stepper";
import { LastLogged, RestDone, SetProgress, announce } from "@/components/training/session-parts";
import {
  activityTypes, blockLabel, distanceMeters, entryValues, parseEntry, exerciseSets, inferActivityType, prefillFor, restPhase, sessionPrevious,
  sessionSummary, setPosition, type Metric,
} from "@/lib/training-view";
function ActivityPicker({ value, onChange }: { value: string; onChange(type: string): void }) {
  return (
    <>
      <Copy kind="label">Activity type</Copy>
      <ChipRow wrap>
        {activityTypes.map((type) => (
          <Chip key={type.value} label={type.label} selected={value === type.value} onPress={() => onChange(type.value)} />
        ))}
      </ChipRow>
    </>
  );
}
// Survives remounts, so returning to the screen within the "Rest done" window does not alert twice.
let alertedRest = "";
export default function Training() {
  const { api, units, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const { store, state, ready, error: restoreError, retry } = useOfflineTraining();
  const past = useQuery(sessionsQuery(api, owner, enrollment));
  const cache = useQueryClient();
  const d = state.active;
  const scope = useMemo(() => ({}), [owner, enrollment?.generation, storage, store]);
  const live = useRef<object | null>(null);
  useLayoutEffect(() => {
    live.current = scope;
    return () => { if (live.current === scope) live.current = null; };
  }, [scope]);
  const current = () => live.current === scope && storage.isCurrent() && isCurrentAccount();
  const sameSession = () => current() && d != null && store?.snapshot().active?.id === d.id;
  const reminders = useReminders();
  const [now, setNow] = useState(Date.now());
  const [input, setInput] = useState<Record<string, string>>({});
  const inputRef = useRef(input);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const operation = useRef<object | null>(null);
  const checkpointing = useRef(false);
  const backgroundPausePending = useRef(false);
  const [advanced, setAdvanced] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [finishReview, setFinishReview] = useState(false);
  const [metric, setMetric] = useState<Metric>("reps");
  const [moreInstructions, setMoreInstructions] = useState(false);
  const [summary, setSummary] = useState<(ReturnType<typeof sessionSummary> & { partial: boolean }) | null>(null);
  const finishing = useRef(false);
  const phase = restPhase(d?.rest_until ?? null, now);
  useEffect(() => {
    // One alert when a rest runs out on its own; "End rest" clears the timer instead.
    const key = `${d?.id}:${d?.rest_until}`;
    if (phase !== "done" || d?.rest_until == null || alertedRest === key || !sameSession()) return;
    alertedRest = key;
    announce("Rest done");
    // An enabled device rest alert already plays in the foreground; don't double it with a haptic.
    if (!(reminders.state.settings.rest_enabled && reminders.state.permission === "granted")) haptics.success();
  }, [phase, d?.rest_until]);
  useLayoutEffect(() => { setSummary(null); finishing.current = false; }, [scope]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const active = store?.snapshot().active;
    if (!sameSession() || !active?.timed_circuit || active.paused || checkpointing.current ||
      (now - active.checkpoint_at < 5000 && circuitRemaining(active, now)! > 0)) return;
    checkpointing.current = true;
    void store!.checkpoint().catch(() => { if (sameSession()) setError("Could not save the circuit timer on this device. Pause and retry."); })
      .finally(() => { if (sameSession()) checkpointing.current = false; });
  }, [now, store, d?.id, d?.paused, scope]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      const active = store?.snapshot().active;
      if (sameSession() && status !== "active" && active?.timed_circuit && !active.paused && !backgroundPausePending.current) {
        backgroundPausePending.current = true;
        void store!.pause(true).catch(() => { if (sameSession()) setError("Could not pause the circuit on this device. Review its saved timer before resuming."); })
          .finally(() => { if (sameSession()) backgroundPausePending.current = false; });
      }
    });
    return () => sub.remove();
  }, [store, scope, d?.id]);
  useLayoutEffect(() => { setFinishReview(false); setBusy(false); setError(""); setMore(false); setInstructionsOpen(false);
    if (d) setSummary(null);
    guard.current = false; operation.current = null; checkpointing.current = false; backgroundPausePending.current = false;
  }, [scope, d?.id]);
  useLayoutEffect(() => {
    const restored = d?.input ?? {};
    setInput(restored);
    inputRef.current = restored;
  }, [scope, d?.id, d?.cursor]);
  useEffect(() => {
    const exercise = d?.steps[d.cursor]?.exercise;
    setMetric(exercise?.duration_seconds != null ? "time" : exercise?.distance_meters != null ? "distance" : "reps");
    setAdvanced(false);
    setMoreInstructions(false);
  }, [scope, d?.id, d?.cursor]);
  function field(key: string, value: string) {
    if (!sameSession()) return;
    const next = { ...inputRef.current, [key]: value };
    inputRef.current = next;
    setInput(next);
    void store
      ?.input(next)
      .catch(() => { if (sameSession()) setError("Could not save your current inputs locally. Keep this screen open and retry."); });
  }
  async function run(work: () => Promise<void>) {
    if (guard.current || !sameSession()) return;
    guard.current = true;
    const attempt = {}; operation.current = attempt;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (current() && operation.current === attempt) setError(e instanceof Error ? e.message : "Could not save on this device.");
    } finally {
      if (current() && operation.current === attempt) { operation.current = null; guard.current = false; setBusy(false); }
    }
  }
  if (summary)
    return (
      <Screen
        title={summary.partial ? "Partial session saved" : "Session saved"}
        footer={<Button title="Done" icon="checkmark" size="lg" onPress={() => router.replace("/(tabs)/progress")} />}
      >
        <Copy tone="muted">Saved on this device. It uploads to your history when you are online.</Copy>
        <Row gap={12} wrap>
          <StatTile value={summary.sets} label={summary.sets === 1 ? "Set logged" : "Sets logged"} icon="checkmark-done" />
          <StatTile value={summary.exercises} label={summary.exercises === 1 ? "Exercise" : "Exercises"} icon="barbell-outline" />
          <StatTile value={summary.active.value} unit={summary.active.unit} label="Active time" icon="time-outline" />
        </Row>
      </Screen>
    );
  if (restoreError)
    return (
      <Screen back title="Restore session">
        <Notice error>{restoreError}</Notice>
        <Button title="Try restoring again" onPress={retry} />
      </Screen>
    );
  if (!ready)
    return (
      <Screen back title="Restore training">
        <Copy>Loading your saved session…</Copy>
      </Screen>
    );
  if ((!d || !store) && finishing.current)
    return (
      <Screen title="Saving session">
        <Copy>Saving on this device…</Copy>
      </Screen>
    );
  if (!d || !store)
    return (
      <Screen back title="Ready when you are">
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
  const previous = step
    ? previousActual(d.workout, step, [
        ...effectiveTrainingHistory(state.history, past.data, enrollment?.generation ?? 0, sessionReadStartedAt(past.data))
          .map((h) => ({ workout: h.workout, actuals: h.request.actuals })),
      ])
    : null;
  const prefill = e ? prefillFor(e, sessionPrevious(d.actuals, step) ?? previous, units) : {};
  const unitOf = (values: Record<string, string>) =>
    values.load_unit === "kg" || values.load_unit === "lb" ? values.load_unit : units === "imperial" ? "lb" : "kg";
  const values = entryValues(prefill, input, metric);
  const unit = unitOf(values);
  const activity = d.activity_type ?? inferActivityType(d.workout);
  const chooseActivity = (type: string) => { void run(() => store.activityType(type)); };
  const rest = remainingSeconds(d.rest_until, now);
  const interval = d.interval_started_at == null ? 0 : Math.max(0, Math.floor((now - d.interval_started_at) / 1000));
  async function log(completed: boolean) {
    if (!current() || !step || !store || store.snapshot().active?.id !== d!.id)
      throw Error("This session changed. Review the current session before logging.");
    const submitted = inputRef.current;
    // A logged set saves the values shown (typed or cleared values win); a skip keeps only what was typed.
    const entry = completed ? entryValues(prefill, submitted, metric) : submitted;
    const optional = (key: string) => parseEntry(entry[key]);
    const load = optional("load");
    const actual: ActualSet = {
      block_id: step.block_id,
      exercise_index: step.exercise_index,
      set_index: step.set_index,
      round_index: step.round_index,
      side: step.side,
      completed,
      reps: optional("reps"),
      duration_seconds: optional("seconds"),
      distance_meters: distanceMeters(entry, submitted, prefill, units),
      load,
      load_unit: load == null ? null : unitOf(entry),
      load_convention: load == null ? null : (entry.convention as ActualSet["load_convention"]) || null,
      difficulty: (submitted.difficulty as ActualSet["difficulty"]) || null,
      effort: optional("effort"),
      pain_reported: submitted.pain === "yes" ? true : submitted.pain === "no" ? false : null,
      notes: submitted.notes || null,
    };
    await store.log(actual);
    if (!sameSession()) return;
    Keyboard.dismiss(); // Never leave the keyboard over the rest timer.
    announce(completed ? `Logged ${e?.name ?? "set"}. ${summaryOf(actual)}` : `Skipped ${e?.name ?? "set"}`);
    // Cursor hydration or a newer edit may already own these shared UI refs.
    // Ownership follows the input object, rather than depending on cursor movement.
    if (inputRef.current === submitted) {
      inputRef.current = {};
      setInput({});
    }
    if (completed) haptics.light();
  }
  async function finish(status: "completed" | "partial", discardUnlogged = false) {
    if (!current() || store!.snapshot().active?.id !== d!.id) throw Error("This session changed. Review the current session before finishing.");
    finishing.current = true;
    try {
      // The inferred type is passed through, not stored, so a failed finish leaves no "chosen" type behind.
      await store!.finish(status, undefined, discardUnlogged ? "discard" : "keep", activity);
    } catch (failure) {
      finishing.current = false;
      throw failure;
    }
    if (!current() || store!.snapshot().active != null) { finishing.current = false; return; }
    haptics.success();
    const saved = store!.snapshot().history.find((h) => h.request.client_session_id === d!.id);
    void store!.sync(api.saveSession).then(() => { if (current()) void cache.invalidateQueries({ queryKey: [owner, "sessions"] }); });
    if (saved) setSummary({ ...sessionSummary(saved.request), partial: status === "partial" });
    else router.replace("/(tabs)/progress");
  }
  const recorded = d.actuals.filter((a) => a.completed).length;
  const timed = d.timed_circuit;
  const capRemaining = circuitRemaining(d, now);
  const capReached = timed != null && capRemaining === 0;
  const timedComplete = capReached && recorded > 0 && !timed.limit_reached && !d.actuals.some((a) => !a.completed);
  const pendingEntry = hasUnloggedInput(input);
  function requestPartialFinish() {
    if (guard.current || !sameSession()) return;
    setMore(false);
    if (!d?.activity_type || hasUnloggedInput(inputRef.current) || hasUnloggedInput(store!.snapshot().active?.input)) {
      setFinishReview(true);
      return;
    }
    void run(() => finish("partial"));
  }
  function finishWithEntry() {
    void run(async () => {
      if (!current() || store!.snapshot().active?.id !== d!.id) throw Error("This session changed. Review the current session before finishing.");
      if (hasUnloggedInput(inputRef.current)) await log(true);
      await finish("partial");
    });
  }
  const nextStep = d.steps[d.cursor + 1];
  const next = nextStep?.exercise;
  const canFinish = !timed && !structureWarning && d.cursor === d.steps.length && !d.actuals.some((a) => !a.completed);
  const target = e
    ? [
        e.reps_min != null
          ? `${e.reps_min}${e.reps_max != null && e.reps_max !== e.reps_min ? `–${e.reps_max}` : ""} reps${e.per_side ? " each side" : ""}`
          : null,
        e.duration_seconds != null ? `${e.duration_seconds}s` : null,
        e.distance_meters != null ? `${e.distance_meters}m` : null,
      ].filter(Boolean).join(" · ") || "Reps not specified"
    : "";
  const details = e
    ? [
        e.load != null ? `Load ${e.load}${e.load_unit ? ` ${e.load_unit}` : ""}${e.load_convention ? ` ${e.load_convention.replaceAll("_", " ")}` : ""}` : null,
        e.tempo ? `Tempo ${e.tempo}` : null,
        e.effort ? `Effort ${e.effort}` : null,
      ].filter(Boolean).join(" · ")
    : "";
  const position = setPosition(d.steps, d.cursor, !!timed);
  const group = step ? blockLabel(step.block_label, step.grouping, d.workout.blocks.length) : null;
  const last = d.actuals.at(-1);
  const lastName = last && d.workout.blocks.find((b) => b.id === last.block_id)?.exercises[last.exercise_index]?.name;
  const canUndo = timed ? d.actuals.length > 0 : d.undo.length > 0;
  const loadStepper = (
    <NumberStepper label={`Actual load · ${unit}`} value={values.load ?? ""} decimal step={unit === "kg" ? 2.5 : 5}
      onChange={(v) => field("load", v)} />
  );
  const discard = () =>
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
    ]);
  return (
    <Screen
      back
      eyebrow={`${recorded} ${timed ? (recorded === 1 ? "entry" : "entries") : (recorded === 1 ? "set" : "sets")} recorded · saved on this device`}
      title={d.workout.title}
      action={
        <Row gap={8}>
          <IconButton
            icon={d.paused ? "play" : "pause"}
            label={capReached ? "Time cap reached" : d.paused ? "Resume session" : "Pause session"}
            disabled={busy || capReached}
            onPress={() => {
              void run(() => store.pause(!d.paused));
            }}
          />
          <IconButton icon="ellipsis-horizontal" label="More session actions" onPress={() => setMore(true)} />
        </Row>
      }
      footer={<>
        {!!error && <Notice error>{error}</Notice>}
        {timedComplete && !pendingEntry ? (
          <Button title="Finish at time cap and save" icon="checkmark-done" size="lg" busy={busy}
            onPress={() => { void run(() => finish("completed")); }} />
        ) : step && e ? (
          <Button
            title={step.side ? `Log ${step.side} side` : timed ? "Log this exercise" : "Log this set"}
            icon="checkmark"
            size="lg"
            busy={busy}
            disabled={(d.paused && !capReached) || !!structureWarning}
            onPress={() => {
              void run(() => log(true));
            }}
          />
        ) : canFinish ? (
          <Button
            title="Finish and save session"
            icon="checkmark-done"
            size="lg"
            busy={busy}
            onPress={() => {
              void run(() => finish("completed"));
            }}
          />
        ) : (
          <Button
            title="Finish as partial session"
            size="lg"
            disabled={busy || !d.actuals.length}
            onPress={requestPartialFinish}
          />
        )}
      </>}
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
      {timed && <Card compact tone="accent">
        <Copy kind="caption" tone="accent">{formatClock(timed.time_cap_seconds)} source time cap</Copy>
        <Copy kind="heading">{formatClock(capRemaining ?? 0)}</Copy>
        <Copy kind="small">Round {step?.round_index ?? Math.ceil(d.steps.length / timed.round_size)} · {completedCircuitRounds(d.actuals, timed.round_size)} complete rounds logged</Copy>
        {capReached && <Notice>Time’s up. Log any final exercise, then save your session.</Notice>}
        {timed.limit_reached && <Notice tone="warning">This session reached its tracking limit. Save the recorded work as a partial session.</Notice>}
        {timedComplete && step && <Button title="Record final exercise before finishing" secondary disabled={busy}
          onPress={() => { void run(() => log(true)); }} />}
        {timedComplete && <ActivityPicker value={activity} onChange={chooseActivity} />}
      </Card>}
      {d.paused && !capReached && (
        <Notice tone="warning">
          Your session is paused. Restored sessions resume from the last saved checkpoint; time away is not counted as
          active training.
        </Notice>
      )}
      {past.error && <Notice>Previous performance could not be refreshed. Any last result shown comes from saved history.</Notice>}
      {phase === "resting" && (
        <Card>
          <RestTimer
            remaining={rest}
            onAdd={() => {
              void run(() => store.timer("rest", rest + 15));
            }}
            onSkip={() => {
              void run(() => store.timer("rest", 0));
            }}
          />
        </Card>
      )}
      {phase === "done" && (
        <Card compact>
          <RestDone next={e ? [e.name, position].filter(Boolean).join(" · ") : null} />
        </Card>
      )}
      {!!last && (
        <LastLogged
          title={`${last.completed ? "Logged" : "Skipped"} · ${lastName ?? "Exercise"}${timed ? "" : `, set ${last.set_index}`}`}
          summary={last.completed ? summaryOf(last) : "No result recorded"}
          skipped={!last.completed}
          disabled={busy}
          onUndo={canUndo ? () => { void run(() => store.undo()); } : undefined}
        />
      )}
      {step && e ? (
        <>
          <Card compact>
            <Copy kind="title">{e.name}</Copy>
            {!!position && <Copy kind="numericSmall">{position}</Copy>}
            {!!group && <Copy kind="small" tone="muted">{group}</Copy>}
            {!timed && <SetProgress sets={exerciseSets(d.steps, d.cursor, d.actuals)} />}
            <Copy kind="subheading">{target}</Copy>
            {!!details && <Copy tone="muted">{details}</Copy>}
            {previous && <Copy tone="muted">Last time · {summaryOf(previous)}</Copy>}
            {!!e.instructions && (
              <>
                <Copy tone="muted" numberOfLines={moreInstructions ? undefined : 2}>{e.instructions}</Copy>
                {e.instructions.length > 90 && (
                  <Button title={moreInstructions ? "Less" : "More"} variant="ghost" size="sm" inline
                    onPress={() => setMoreInstructions(!moreInstructions)} />
                )}
              </>
            )}
            <Button title="Workout instructions" variant="ghost" onPress={() => setInstructionsOpen(true)} />
          </Card>
          {e.sets == null && !timed && (
            <Notice>The source does not specify sets. Log what you do; add another set if you choose additional work.</Notice>
          )}
          {!!next && (
            <Copy kind="small" tone="muted">
              Up next · {next.name} · set {nextStep!.target_set}
              {nextStep!.side ? ` · ${nextStep!.side} side` : ""}
            </Copy>
          )}
          <SectionHeader title="What you actually did" />
          <Segmented<typeof metric>
            label="What to record"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "reps", label: "Reps" },
              { value: "time", label: "Time" },
              { value: "distance", label: "Distance" },
            ]}
          />
          {metric === "reps" && (
            <NumberStepper label="Actual reps" step={1} value={values.reps ?? ""} onChange={(v) => field("reps", v)} />
          )}
          {metric === "time" && (
            <>
              <NumberStepper label="Actual time · seconds" step={5} value={values.seconds ?? ""}
                onChange={(v) => field("seconds", v)} />
              {d.interval_started_at != null ? (
                <Card tone="sunken" compact>
                  <Copy kind="numeric">{formatClock(interval)}</Copy>
                  <Button
                    title="Use elapsed seconds and stop timer"
                    secondary
                    disabled={d.paused || !!structureWarning}
                    onPress={() => {
                      field("seconds", String(interval));
                      void run(() => store.timer("interval", 0));
                    }}
                  />
                </Card>
              ) : (
                <Button
                  title="Start interval timer"
                  secondary
                  icon="timer-outline"
                  disabled={d.paused || !!structureWarning}
                  onPress={() => {
                    void run(() => store.timer("interval"));
                  }}
                />
              )}
            </>
          )}
          {metric === "distance" && (
            <NumberStepper label={`Actual distance · ${units === "imperial" ? "miles" : "metres"}`} decimal
              step={units === "imperial" ? 0.1 : 100} value={values.distance ?? ""} onChange={(v) => field("distance", v)} />
          )}
          {prefill.load != null && loadStepper}
          <Button
            title={advanced ? "Hide load and feedback" : "Add load or feedback"}
            variant="ghost"
            icon={advanced ? "chevron-up" : "add"}
            onPress={() => setAdvanced(!advanced)}
          />
          {advanced && (
            <Card>
              {prefill.load == null && loadStepper}
              <Segmented<"kg" | "lb">
                label="Load unit"
                value={unit}
                onChange={(value) => field("load_unit", value)}
                options={[
                  { value: "kg", label: "kg" },
                  { value: "lb", label: "lb" },
                ]}
              />
              {!!values.load?.trim() && (
                <>
                  <Copy kind="label">How is that load measured?</Copy>
                  <ChipRow wrap>
                    {(["total", "per_hand", "added", "assistance"] as const).map((value) => (
                      <Chip
                        key={value}
                        label={
                          {
                            total: "Total external load",
                            per_hand: "Per hand",
                            added: "Added to bodyweight",
                            assistance: "Assistance weight",
                          }[value]
                        }
                        selected={values.convention === value}
                        onPress={() => field("convention", value)}
                      />
                    ))}
                  </ChipRow>
                </>
              )}
              <Field
                label="Effort · 0 to 10"
                optional
                numeric
                value={input.effort ?? ""}
                onChange={(v) => field("effort", v)}
              />
              <Copy kind="small" tone="muted">
                0 = no effort · 10 = maximum effort. Leave blank if you prefer.
              </Copy>
              <Copy kind="label">How did the set feel?</Copy>
              <ChipRow wrap>
                {(["easy", "manageable", "hard"] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    selected={input.difficulty === value}
                    onPress={() => field("difficulty", input.difficulty === value ? "" : value)}
                  />
                ))}
              </ChipRow>
              <Copy kind="label">Any pain during this set?</Copy>
              <ChipRow wrap>
                {(["yes", "no"] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value === "yes" ? "Yes, pain reported" : "No pain reported"}
                    selected={input.pain === value}
                    onPress={() => field("pain", input.pain === value ? "" : value)}
                  />
                ))}
              </ChipRow>
              {input.pain === "yes" && (
                <Notice tone="warning">
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
            </Card>
          )}
        </>
      ) : (
        <>
          <Empty
            icon="checkmark-circle-outline"
            title={timed ? (timed.limit_reached ? "Tracking limit reached" : "Time cap reached") : "You've reached the end"}
            description={timed ? "Review your recorded work, then explicitly save. Skipped work and tracking limits stay partial." : "Nice work. Review your recorded work below, then save the session. Skipped sets stay visible as partial training."}
          />
          {d.open_ended && !timed && <Button title="Add another round" icon="add-circle-outline" secondary inline
            disabled={busy || !!structureWarning} onPress={() => { void run(() => store.addRound()); }} />}
          {!timedComplete && <ActivityPicker value={activity} onChange={chooseActivity} />}
        </>
      )}
      {!step && <Button title="Workout instructions" variant="ghost" onPress={() => setInstructionsOpen(true)} />}
      {!!reminders.state.error && (
        <Notice>Optional rest alert could not be updated. The in-app timer still works. {reminders.state.error}</Notice>
      )}
      {reminders.state.settings.rest_enabled && reminders.state.permission !== "granted" && (
        <Notice>Device rest alerts are unavailable or not permitted. Your in-app timer still works.</Notice>
      )}
      {!!d.actuals.length && (
        <>
          <SectionHeader title="Recorded work" />
          <Card compact>
            {d.actuals.map((a, i) => (
              <SetRow
                key={actualIdentity(a)}
                number={i + 1}
                summary={a.completed ? summaryOf(a) : "Skipped"}
                hint={d.workout.blocks.find((b) => b.id === a.block_id)?.exercises[a.exercise_index]?.name}
                state={a.completed ? "done" : "skipped"}
              />
            ))}
          </Card>
        </>
      )}
      <Sheet visible={instructionsOpen} onClose={() => setInstructionsOpen(false)} title="Workout instructions">
        {!!error && <Notice error>{error}</Notice>}
        {!!e && <Copy kind="heading">{e.name}</Copy>}
        {!!e?.instructions && <Copy tone="muted">{e.instructions}</Copy>}
        {!!e?.notes && <Copy tone="muted">Private note · {e.notes}</Copy>}
        {!!d.workout.source_url && (
          <ListRow
            icon="play-circle-outline"
            title="Open original instructions"
            detail="Your place here is saved"
            trailing="external"
            onPress={() => {
              void Linking.openURL(d.workout.source_url!).catch(() =>
                { if (sameSession()) setError("Could not open the source. Your session remains saved."); }
              );
            }}
          />
        )}
        <WorkoutInstructions instructions={d.workout.instructions} />
        {timed && <Copy kind="small" tone="muted">Repeat the circuit until the time cap. Log each exercise as you go; pause when you need to step away.</Copy>}
      </Sheet>
      <Sheet visible={more} onClose={() => setMore(false)} title="Session">
        {step && e && (
          <>
            <ListRow
              icon="play-skip-forward-outline"
              title={timed ? "Skip this exercise entry" : "Skip this set"}
              disabled={busy || d.paused || !!structureWarning}
              onPress={() => {
                setMore(false);
                void run(() => log(false));
              }}
            />
            {!timed && <ListRow
              icon="add-circle-outline"
              title="Add another set of this exercise"
              disabled={busy || !!structureWarning}
              onPress={() => {
                setMore(false);
                void run(() => store.addSet());
              }}
            />}
            {!timed && d.open_ended && <ListRow
              icon="repeat-outline"
              title="Add another round"
              detail="Repeats this part of the workout once more"
              disabled={busy || !!structureWarning}
              onPress={() => {
                setMore(false);
                void run(() => store.addRound());
              }}
            />}
          </>
        )}
        {!!d.actuals.length && (
          <ListRow
            icon="arrow-undo-outline"
            title={timed ? "Undo last exercise entry" : "Undo last set"}
            disabled={busy}
            onPress={() => {
              setMore(false);
              void run(() => store.undo());
            }}
          />
        )}
        <ListRow
          icon="flag-outline"
          title="Finish as partial session"
          detail="Saves what you recorded so far"
          disabled={busy || !d.actuals.length}
          onPress={requestPartialFinish}
        />
        <ListRow
          icon="trash-outline"
          title="Discard this session"
          destructive
          disabled={busy}
          onPress={() => {
            setMore(false);
            discard();
          }}
        />
      </Sheet>
      <Sheet visible={finishReview} onClose={() => { if (!busy) setFinishReview(false); }} title={pendingEntry ? "Keep your current entry?" : "Save partial session"}>
        <Copy>{pendingEntry
          ? "You have details that have not been logged. Choose what to keep before saving this partial session."
          : "Your entry is recorded. Finish saving this partial session, or keep training."}</Copy>
        {!!error && <Notice error>{error}</Notice>}
        <ActivityPicker value={activity} onChange={chooseActivity} />
        {d.paused && !capReached && <Notice>Resume training to log this entry, or save only the work already recorded.</Notice>}
        <Button title={pendingEntry ? "Log and finish" : "Finish and save partial session"} icon="checkmark-done" busy={busy}
          disabled={pendingEntry && (!step || !!structureWarning || (d.paused && !capReached))} onPress={finishWithEntry} />
        {pendingEntry && <Button title="Finish without this entry" secondary disabled={busy}
          onPress={() => { void run(() => finish("partial", true)); }} />}
        <Button title="Keep training" variant="ghost" disabled={busy} onPress={() => setFinishReview(false)} />
      </Sheet>
    </Screen>
  );
}

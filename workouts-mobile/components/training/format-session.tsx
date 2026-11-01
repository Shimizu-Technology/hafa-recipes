import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Speech from "expo-speech";
// Installed and natively linked through `expo` (SDK 57); declare it directly at the next dependency-lock review.
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Button, Card, Copy, Field, IconButton, ListRow, Notice, Row, Screen, SectionHeader, SetRow, Sheet, formatClock, haptics, useColors } from "@/components/ui";
import { WorkoutInstructions } from "@/components/workout-instructions";
import { announce } from "@/components/training/session-parts";
import { largeText } from "@/lib/readable-layout";
import type { ActualSet } from "@/lib/models";
import { actualIdentity, capRemainingSeconds, sessionElapsedMilliseconds, summaryOf, type SessionDraft, type TrainingStep } from "@/lib/training";
import { parseEntry } from "@/lib/training-view";
import { formatDescription, formatLabel, intervalPosition, isDeathBy, moveText, movesFor, repsFor } from "@/lib/timed-execution";

// Kept for the app session, so a remount mid-workout doesn't silence cues the person turned on.
let voiceCues = false;
/** The actual for one step. A completed step records the prescribed dose the person just confirmed, or what they typed. */
function actualFor(step: TrainingStep, completed: boolean, typed: number | null, workSeconds: number | null): ActualSet {
  const e = step.exercise;
  const reps = typed ?? (completed ? repsFor(e, step.round_index) : null);
  // Inside work/rest the work interval is the dose; elsewhere prescribed time or distance stands in only when there are no reps.
  const duration = completed ? workSeconds ?? (reps == null ? e.duration_seconds ?? null : null) : null;
  return {
    block_id: step.block_id, exercise_index: step.exercise_index, set_index: step.set_index, round_index: step.round_index, side: step.side,
    completed, reps, duration_seconds: duration,
    distance_meters: completed && reps == null && duration == null ? e.distance_meters ?? null : null,
  };
}

export function FormatSession({ d, now, busy, error, activityPicker, log, pause, undo, finish, discard }: {
  d: SessionDraft & { timed_format: NonNullable<SessionDraft["timed_format"]> };
  now: number; busy: boolean; error: string; activityPicker: ReactNode;
  log(actuals: ActualSet[]): void; pause(paused: boolean): void; undo(): void;
  finish(status: "completed" | "partial", before?: ActualSet[]): void; discard(): void;
}) {
  const c = useColors();
  const { fontScale, width } = useWindowDimensions();
  const [more, setMore] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [voice, setVoice] = useState(voiceCues);
  const [typed, setTyped] = useState("");
  // Reps typed for each EMOM move that has no prescribed dose, by exercise index.
  const [counts, setCounts] = useState<Record<number, string>>({});
  const format = d.timed_format;
  const block = d.workout.blocks[0];
  const elapsed = sessionElapsedMilliseconds(d, now);
  const remaining = capRemainingSeconds(d, now);
  const capReached = remaining === 0;
  const step = d.steps[d.cursor];
  const deathBy = isDeathBy(format, block);
  const lastRound = Math.max(0, ...d.actuals.map((a) => a.round_index));
  const allMarked = d.cursor === d.steps.length;
  // The work is over: for time finished or capped, or Death by ended. The clock is stopped, so Pause no longer applies.
  const finished = capReached || (allMarked && (format.mode === "for_time" || deathBy));
  const canComplete = allMarked && d.actuals.length > 0 && d.actuals.every((a) => a.completed || (deathBy && a.round_index === lastRound));
  const interval = format.mode === "for_time" ? null : format;
  const position = interval ? intervalPosition(interval, elapsed) : null;
  const unit = format.mode === "emom" && format.interval_seconds === 60 ? "Minute" : "Interval";
  const target = step?.round_index ?? null;
  const targetSteps = target == null ? [] : d.steps.slice(d.cursor).filter((s, i, list) => s.round_index === target && list.slice(0, i).every((x) => x.round_index === target));
  const started = target != null && (!position || target <= position.index);
  const moves = (round: number) => interval
    ? movesFor(interval, block, round).map((i) => moveText(block.exercises[i], round)).join(" + ")
    : block.exercises.map((e) => moveText(e, round)).join(", ");
  const amount = parseEntry(typed);
  const validReps = (value: number | null) => value == null || (Number.isInteger(value) && value >= 0 && value <= 1000);
  // EMOM moves this interval with no prescribed dose: the person types reps for each of them (each side for a
  // per-side move), and the moves with a dose keep it.
  const doseless = format.mode === "emom" ? [...new Set(targetSteps.filter((s) => repsFor(s.exercise, s.round_index) == null &&
    s.exercise.duration_seconds == null && s.exercise.distance_meters == null).map((s) => s.exercise_index))] : [];
  const countFor = (index: number) => parseEntry(counts[index] ?? "");
  const typedValid = validReps(amount) && doseless.every((i) => validReps(countFor(i)));
  const workSeconds = format.mode === "work_rest" ? format.work_seconds : null;
  const askReps = format.mode === "work_rest" || doseless.length > 0;
  const perSide = targetSteps.some((s) => s.side != null);
  useEffect(() => { setTyped(""); setCounts({}); }, [d.cursor]);

  // One cue per phase change while the clock runs: haptic, a VoiceOver announcement and, if chosen, a spoken word.
  const cue = position ? `${position.index}:${position.phase}` : capReached ? "cap" : "running";
  const previousCue = useRef(cue);
  useEffect(() => {
    const before = previousCue.current;
    previousCue.current = cue;
    if (before === cue || (d.paused && !capReached)) return;
    const message = capReached || position?.phase === "ended" ? "Time" : position?.phase === "rest" ? "Rest"
      : format.mode === "work_rest" ? "Work" : `${unit} ${position!.index}. ${moves(position!.index)}`;
    haptics.warning();
    announce(message);
    if (voice) Speech.speak(message.split(".")[0]);
  }, [cue]);
  // Keep the screen on while the clock runs, so interval cues still fire with the phone set down.
  const running = !d.paused && !finished;
  useEffect(() => {
    if (!running) return;
    const tag = `format-session:${d.id}`;
    void activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => { void deactivateKeepAwake(tag).catch(() => undefined); };
  }, [running, d.id]);

  const mark = (completed: boolean) => {
    if (!typedValid) return;
    // Done keeps each prescribed dose, and a miss keeps only what was typed. Typed reps go to the move they were
    // typed for, on every side: a dose-less EMOM move, the work/rest move, or the first move of a missed Death by minute.
    const typedFor = (s: TrainingStep, i: number) => format.mode === "work_rest" ? amount
      : doseless.includes(s.exercise_index) ? countFor(s.exercise_index)
      : !completed && deathBy && i === 0 ? amount : null;
    log(targetSteps.map((s, i) => actualFor(s, completed, typedFor(s, i), completed ? workSeconds : null)));
  };
  // For time: tick moves up to and including `index` in this round.
  const tickThrough = (index: number) => {
    const through = d.steps.slice(d.cursor).filter((s, i, list) => s.round_index === target && list.slice(0, i + 1).every((x) => x.round_index === target));
    const last = through.findLastIndex((s) => s.exercise_index === index);
    if (last >= 0) log(through.slice(0, last + 1).map((s) => actualFor(s, true, null, null)));
  };
  const stopEarly = () => {
    if (!d.actuals.length && amount == null) { discard(); return; }
    const partial = format.mode === "for_time" && step && amount != null ? [actualFor(step, false, amount, null)] : [];
    finish("partial", partial);
  };

  // Whole seconds elapsed, the same way the saved finish time counts them.
  const clockText = format.mode === "for_time" ? formatClock(Math.floor(elapsed / 1000)) : formatClock(position!.remaining);
  // The clock grows with text size up to 1.6×, and never past the card's width: tabular digits are about
  // 0.62 em. A computed size, not adjustsFontSizeToFit, which clips on the new architecture. With the capped
  // caption and phase word it stays above the footer at the largest text size.
  const clockSize = Math.min(56 * Math.min(fontScale, 1.6), (width - 96) / (clockText.length * 0.62));
  const caption = format.mode === "for_time"
    ? [format.time_cap_seconds != null ? `Cap ${formatClock(format.time_cap_seconds)}` : "No time cap", `Round ${Math.min(target ?? lastRound, block.rounds ?? 1)} of ${block.rounds ?? 1}`].join(" · ")
    : `${unit} ${position!.index}${interval!.intervals != null ? ` of ${interval!.intervals}` : ""}`;
  const resting = !!position && !allMarked && target != null && target > position.index;
  const phaseWord = format.mode === "work_rest" && position && position.phase !== "ended" ? (position.phase === "work" ? "Work" : "Rest") : null;
  const nowLine = !position ? null
    : allMarked ? (deathBy ? `Ended in ${unit.toLowerCase()} ${lastRound}` : `All ${unit.toLowerCase()}s marked`)
    : position.phase === "ended" ? "Time’s up. Mark what’s left below."
    : resting ? `Done · rest until ${unit.toLowerCase()} ${position.index + 1}`
    : `This ${unit.toLowerCase()}: ${moves(position.index)}`;
  const hasNext = !!position && !allMarked && position.phase !== "ended" && (interval!.intervals == null || position.index < interval!.intervals);

  // At the largest text sizes four stacked footer buttons would cover the clock; their labels stop growing at 1.6×.
  const footerScale = 1.6;
  const primary = canComplete ? (
    <Button maxScale={footerScale} title="Save session" icon="checkmark-done" size="lg" busy={busy} onPress={() => finish("completed")} />
  ) : format.mode === "for_time" ? (
    step && !capReached ? <Button maxScale={footerScale} size="lg" icon="checkmark" busy={busy}
      title={(block.rounds ?? 1) === 1 ? "Done · stop the clock" : target === (block.rounds ?? 1) ? `Round ${target} done · stop the clock` : `Round ${target} done`}
      onPress={() => log(targetSteps.map((s) => actualFor(s, true, null, null)))} />
      : <Button maxScale={footerScale} title="Save capped result" icon="checkmark-done" size="lg" busy={busy} disabled={!typedValid} onPress={stopEarly} />
  ) : step && started ? (
    <View style={{ flexDirection: largeText(fontScale) ? "column" : "row", gap: 12 }}>
      <View style={{ flex: largeText(fontScale) ? undefined : 2 }}>
        <Button maxScale={footerScale} size="lg" icon="checkmark" busy={busy} disabled={!typedValid || doseless.some((i) => countFor(i) == null)}
          title={format.mode === "work_rest" ? `Log interval ${target}` : `Done · ${unit.toLowerCase()} ${target}`} onPress={() => mark(true)} />
      </View>
      <View style={{ flex: largeText(fontScale) ? undefined : 1 }}>
        <Button maxScale={footerScale} size="lg" variant="secondary" disabled={busy || !typedValid} title={format.mode === "work_rest" ? "Skip" : "Missed"} onPress={() => mark(false)} />
      </View>
    </View>
  ) : null;

  return (
    <Screen native back title={formatLabel(block)?.split(" · ")[0] ?? d.workout.title} subtitle={d.workout.title}
      action={<IconButton icon="ellipsis-horizontal" label="More session actions" onPress={() => setMore(true)} />}
      footer={<>
        {!!error && <Notice error>{error}</Notice>}
        {primary}
        <View style={{ flexDirection: largeText(fontScale) ? "column" : "row", gap: 12 }}>
          {!finished && <View style={{ flex: largeText(fontScale) ? undefined : 1 }}>
            <Button maxScale={footerScale} title={d.paused ? "Resume" : "Pause"} icon={d.paused ? "play" : "pause"} variant="secondary"
              disabled={busy} onPress={() => pause(!d.paused)} />
          </View>}
          <View style={{ flex: largeText(fontScale) ? undefined : 1 }}>
            <Button maxScale={footerScale} title="Finish" icon="flag-outline" variant="secondary" disabled={busy}
              onPress={() => (canComplete ? finish("completed") : setStopping(true))} />
          </View>
        </View>
      </>}
    >
      <Card tone="accent">
        <Copy kind="caption" tone="accent" maxScale={2}>{caption}</Copy>
        {!!phaseWord && <Copy kind="title" maxScale={1.6} tone={phaseWord === "Work" ? "accent" : "muted"} accessibilityLabel={`${phaseWord} phase`}>{phaseWord}</Copy>}
        <Copy kind="numeric" allowFontScaling={false} numberOfLines={1} style={{ fontSize: clockSize, lineHeight: Math.ceil(clockSize * 8 / 7) }} accessibilityLabel={`${clockText} ${format.mode === "for_time" ? "elapsed" : "left"}`}>{clockText}</Copy>
        {format.mode === "for_time" && remaining != null && !allMarked && <Copy kind="small">{formatClock(remaining)} left</Copy>}
        {!!nowLine && <Copy kind="label">{nowLine}</Copy>}
        {hasNext && <Copy kind="small" tone="muted">Next · {unit} {position!.index + 1}: {moves(position!.index + 1)}</Copy>}
        {format.mode === "for_time" && allMarked && <Copy kind="label">Finished in {formatClock(Math.floor(elapsed / 1000))}</Copy>}
      </Card>
      {d.paused && !finished && <Notice tone="warning">Paused. The clock is stopped and time away isn’t counted.</Notice>}
      {format.mode === "for_time" && step && (
        <>
          <SectionHeader title={capReached ? "Time cap reached · tick what you finished" : `Round ${target}`} />
          {block.exercises.map((e, i) => {
            const done = d.actuals.some((a) => a.round_index === target && a.exercise_index === i && a.completed);
            return (
              <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: done, disabled: done || busy }} disabled={done || busy}
                accessibilityLabel={moveText(e, target!)} accessibilityHint={done ? undefined : "Ticks this move and the ones before it"} onPress={() => tickThrough(i)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={26} color={done ? c.action : c.muted} />
                <Copy style={{ flex: 1 }} tone={done ? "muted" : "default"}>{moveText(e, target!)}</Copy>
              </Pressable>
            );
          })}
          {capReached && <Field label={`Reps done on ${step.exercise.name}`} optional numeric value={typed} onChange={setTyped} />}
        </>
      )}
      {format.mode !== "for_time" && step && started && (target !== position!.index || askReps || deathBy) && (
        <Card compact>
          <Copy kind="label">{unit} {target} · {moves(target!)}</Copy>
          {target! < position!.index && <Copy kind="small" tone="muted">Not marked yet. Mark it done or missed to keep going.</Copy>}
          {format.mode === "work_rest" && <Field label={`Reps in interval ${target}${perSide ? ", each side" : ""}`}
            optional numeric value={typed} onChange={setTyped} />}
          {doseless.map((i) => (
            <Field key={i} label={`${block.exercises[i].name} reps in ${unit.toLowerCase()} ${target}${block.exercises[i].per_side ? ", each side" : ""}`}
              numeric value={counts[i] ?? ""} onChange={(value) => setCounts((prior) => ({ ...prior, [i]: value }))} />
          ))}
          {deathBy && <Copy kind="small" tone="muted">Missing a {unit.toLowerCase()} ends Death by. Type the reps you got first.</Copy>}
          {deathBy && !askReps && <Field label="Reps if you missed" optional numeric value={typed} onChange={setTyped} />}
        </Card>
      )}
      {!typedValid && <Notice error>Reps must be a whole number from 0 to 1000.</Notice>}
      {(canComplete || capReached || (format.mode === "for_time" && allMarked)) && activityPicker}
      {!!d.actuals.length && (
        <>
          <SectionHeader title="Logged so far" />
          <Card compact>
            {d.actuals.map((a, i) => (
              <SetRow key={actualIdentity(a)} number={a.round_index}
                summary={a.completed ? summaryOf(a) : a.reps != null ? `Missed · ${a.reps} reps` : format.mode === "work_rest" ? "Skipped" : "Missed"}
                hint={[block.exercises[a.exercise_index]?.name, i === 0 || d.actuals[i - 1].round_index !== a.round_index ? `${format.mode === "for_time" ? "Round" : unit} ${a.round_index}` : null].filter(Boolean).join(" · ")}
                state={a.completed ? "done" : "skipped"} />
            ))}
          </Card>
        </>
      )}
      <Sheet visible={stopping} onClose={() => { if (!busy) setStopping(false); }} title="Save partial session?">
        <Copy>{format.mode === "for_time"
          ? "Tick the moves you finished in this round, and add reps on the one you were doing. Unfinished rounds stay partial."
          : `Unmarked ${unit.toLowerCase()}s aren’t recorded. Only what you marked is saved.`}</Copy>
        {format.mode === "for_time" && step && !capReached && <Field label={`Reps done on ${step.exercise.name}`} optional numeric value={typed} onChange={setTyped} />}
        {!!error && <Notice error>{error}</Notice>}
        {activityPicker}
        <Button title={d.actuals.length || amount != null ? "Save partial session" : "Discard session"} icon="checkmark-done" busy={busy}
          disabled={!typedValid} onPress={() => { setStopping(false); stopEarly(); }} />
        <Button title="Keep going" variant="ghost" disabled={busy} onPress={() => setStopping(false)} />
      </Sheet>
      <Sheet visible={more} onClose={() => setMore(false)} title="Session">
        <ListRow icon="book-outline" title="Workout instructions" onPress={() => { setMore(false); setInstructions(true); }} />
        <ListRow icon={voice ? "volume-high-outline" : "volume-mute-outline"} title={voice ? "Voice cues on" : "Voice cues off"}
          detail="Says the interval or Work/Rest when it changes" onPress={() => { voiceCues = !voice; setVoice(!voice); }} />
        {!!d.actuals.length && <ListRow icon="arrow-undo-outline" title={format.mode === "for_time" ? "Undo last tick" : `Undo last ${unit.toLowerCase()}`}
          disabled={busy} onPress={() => { setMore(false); undo(); }} />}
        <ListRow icon="trash-outline" title="Discard this session" destructive disabled={busy} onPress={() => { setMore(false); discard(); }} />
      </Sheet>
      <Sheet visible={instructions} onClose={() => setInstructions(false)} title="Workout instructions">
        <Copy kind="label">{formatDescription(block)}</Copy>
        <WorkoutInstructions instructions={d.workout.instructions} />
        <Row gap={8} wrap><Copy kind="small" tone="muted">Mark each {format.mode === "for_time" ? "round" : unit.toLowerCase()} yourself: the clock never records work for you.</Copy></Row>
      </Sheet>
    </Screen>
  );
}

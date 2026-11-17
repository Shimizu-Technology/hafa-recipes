import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Copy, Field, Segmented, IconButton, ListRow, Notice, RestTimer, Row, Screen, SectionHeader, Sheet, formatClock, haptics, useColors } from "@/components/ui";
import { WorkoutInstructions } from "@/components/workout-instructions";
import { SessionClock } from "@/components/training/session-clock";
import { LeadIn } from "@/components/training/lead-in";
import { announce } from "@/components/training/session-parts";
import { useKeepAwakeWhile } from "@/components/training/keep-awake";
import { prescriptionLine } from "@/lib/discover";
import type { ActualSet } from "@/lib/models";
import { adjustRest, buyInDone, endPart, endRest, isRun, pausePart, resumePart, setRun, skipLeadIn, skipPart, startPart, tapRound, undoTap,
  type ClassRun, type PartResult, type RunEnvironment } from "@/lib/class-session";
import { classPayload, scoreProblem, scoredParts } from "@/lib/class-scores";
import { CopyForWodUp, ScoreEditor } from "@/components/training/score-editor";
import { classOver, currentPart, endClass, hasBuyIn } from "@/lib/class-training";
import { buyInMove, partClock, partTitle, restLeft, restLine, roundMoves, visibleRuns } from "@/lib/class-view";
import { footerCellWidth, footerLabelScale, largeText } from "@/lib/readable-layout";
import { actualIdentity, exerciseElapsedSeconds, restRemainingSeconds, type SessionDraft } from "@/lib/training";
import { moveText, movesFor, repsFor, timedFormatFor, type IntervalFormat } from "@/lib/timed-execution";

type Change = (run: ClassRun, workout: SessionDraft["workout"], now: number) => ClassRun;
export interface ClassSessionProps {
  d: SessionDraft & { class_run: ClassRun };
  now: number; busy: boolean; error: string;
  /** The remembered Outdoor/Treadmill choice for a run without one. */
  runEnvironment: RunEnvironment;
  act(change: Change, environment?: RunEnvironment): void;
  log(actual: ActualSet): void;
  undo(): void;
  timer(kind: "rest" | "interval", seconds?: number): void;
  /** Saves the class with the reviewed scores (each part's score, Rx or Scaled). */
  finish(status: "completed" | "partial", scores?: PartResult[]): void;
  roundLoad?(blockId: string, exerciseIndex: number, load: number | null, unit: "kg" | "lb", convention?: ActualSet["load_convention"]): void;
  runDistance(blockId: string, exerciseIndex: number, meters: number): void;
  discard(): void;
  activityPicker: ReactNode;
}

/** A sweaty-thumb target: the whole width, at least 96 pt tall, coral. */
function BigTap({ title, hint, onPress, disabled }: { title: string; hint?: string; onPress(): void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={() => { haptics.success(); onPress(); }}
      style={({ pressed }) => ({ minHeight: 96, borderRadius: 20, backgroundColor: c.accent, alignItems: "center", justifyContent: "center",
        paddingHorizontal: 16, paddingVertical: 12, opacity: disabled ? 0.5 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Copy kind="heading" maxScale={1.4} style={{ color: c.onAccent, textAlign: "center" }}>{title}</Copy>
    </Pressable>
  );
}
/** One tap switches a run between Outdoor and Treadmill. */
function RunChoice({ label, value, onChange, disabled }: { label: string; value: RunEnvironment; onChange(next: RunEnvironment): void; disabled?: boolean }) {
  const c = useColors();
  const next = value === "outdoor" ? "treadmill" : "outdoor";
  const word = value === "outdoor" ? "Outdoor" : "Treadmill";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${word}`} accessibilityHint={`Switches to ${next === "outdoor" ? "Outdoor" : "Treadmill"}`}
      disabled={disabled} onPress={() => { haptics.tick(); onChange(next); }}
      style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 14,
        borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={value === "outdoor" ? "sunny-outline" : "speedometer-outline"} size={22} color={c.text} />
      <Copy maxScale={1.5} style={{ flex: 1 }}>{label}</Copy>
      <Copy kind="label" maxScale={1.5}>{word}</Copy>
      <Ionicons name="swap-horizontal" size={18} color={c.muted} />
    </Pressable>
  );
}

export function ClassSession(p: ClassSessionProps) {
  const { d, now, busy } = p;
  const { run, part, block, index, status } = currentPart(d.class_run, d.workout, now);
  const over = classOver(d.class_run, d.workout, now);
  const next = d.workout.blocks[index + 1];
  // At large text the clock is pinned above the scrolling body, as on the single-part timer, and the small actions
  // in a two-column row grow only as far as their longest word fits, without their icon, so no label breaks mid-word.
  const { fontScale, width } = useWindowDimensions();
  const grid = largeText(fontScale);
  const half = (title: string) => (grid ? { maxScale: footerLabelScale(title, footerCellWidth(width) - 12, fontScale), icon: undefined } : {});
  const [weights, setWeights] = useState(false);
  const [loadUnits, setLoadUnits] = useState<Record<string, "kg" | "lb">>({});
  const [loadText, setLoadText] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [leadInDone, setLeadInDone] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<string, PartResult>>({});
  useKeepAwakeWhile(!over, `class:${d.id}`);
  // One cue when a part caps, a rest ends or the class is done, even when the change happened while locked.
  const cue = `${index}:${status}`;
  const previous = useRef(cue);
  useEffect(() => {
    if (previous.current === cue) return;
    previous.current = cue;
    const word = status === "resting_after" ? `Time. Rest, ${restLine(next)}` : status === "running" ? `${block.label}, go` : over ? "Class done" : null;
    if (!word) return;
    haptics.warning();
    announce(word);
  }, [cue]);

  const step = d.steps[d.cursor];
  const setPart = !over && part.kind === "sets" && status === "running" && step?.block_id === block.id;
  const invalidLoad = Object.entries(loadText).some(([key, value]) => key.startsWith(`${block.id}:`) && value.trim() !== "" &&
    (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 2000));
  const roundText = (n: number) => `${n} ${n === 1 ? "round" : "rounds"}`;
  const env = (i: number) => part.runs?.[i]?.environment ?? p.runEnvironment;
  const chooseRun = (i: number, next: RunEnvironment) =>
    p.act((r, w, at) => setRun(r, w, i, next, r.parts[r.cursor].runs?.[i]?.distance_meters, at), next);
  const endEarly = () => Alert.alert(`End ${block.label} now?`, "The clock stops here and the class moves on.", [
    { text: "Keep going", style: "cancel" }, { text: `End ${block.label}`, style: "destructive", onPress: () => p.act(endPart) }]);
  const canComplete = over && !run.ended_early && !run.parts.some((x) => x.skipped) && d.actuals.every((a) => a.completed) &&
    d.steps.every((s) => d.actuals.some((a) => actualIdentity(a) === s.key));
  const review = over ? classPayload(run, d.workout, now, d.actuals, { ...d.class_scores, ...edits }) : null;
  // Every scored part is reviewed, including one still missing its value; only valid scores are ever sent.
  const scored = over ? scoredParts(run, d.workout, now, d.actuals, { ...d.class_scores, ...edits }).map((x) => x.result) : [];
  const unready = scored.some((r) => scoreProblem(r) || !r.scaling);
  const save = () => p.finish(canComplete ? "completed" : "partial", scored);

  // A set-by-set part logs the prescribed dose, or the timed hold the person just ran.
  const timing = d.interval_started_at != null;
  const logSet = (completed: boolean) => {
    if (!step) return;
    const e = step.exercise;
    const reps = completed ? repsFor(e, step.round_index) : null;
    const duration = completed && reps == null ? (timing ? exerciseElapsedSeconds(d, now) : e.duration_seconds ?? 0) : null;
    p.log({ block_id: step.block_id, exercise_index: step.exercise_index, set_index: step.set_index, round_index: step.round_index,
      side: step.side, completed, reps, duration_seconds: duration, distance_meters: completed && reps == null && duration == null ? e.distance_meters ?? null : null });
  };
  const setRest = restRemainingSeconds(d, now);
  const holdLeft = timing && step?.exercise.duration_seconds != null ? Math.max(0, step.exercise.duration_seconds - exerciseElapsedSeconds(d, now)) : null;
  useEffect(() => { if (holdLeft === 0) { haptics.warning(); announce("Time"); } }, [holdLeft === 0]);
  const setName = step && block.exercises.length > 1 ? `${block.label}${step.exercise_index + 1}` : block.label;
  const rounds = block.rounds ?? 1;

  let body: ReactNode = null;
  let footer: ReactNode = null;
  let pinned: ReactNode = null;
  if (over) {
    body = <>
      <Copy kind="heading">Class done</Copy>
      <Card compact>
        {run.parts.map((x, i) => {
          const b = d.workout.blocks[i];
          return <ListRow key={b.id} icon={x.skipped ? "remove-circle-outline" : "checkmark-circle"} title={partTitle(b)} detail={x.skipped ? "Skipped" : "Done"} />;
        })}
      </Card>
      {!canComplete && <Copy kind="small" tone="muted">Unfinished or skipped parts and sets save this as a partial session.</Copy>}
      {!!scored.length && <SectionHeader title="Your scores" />}
      {review && scored.map((r) => {
        const b = d.workout.blocks.find((x) => x.id === r.block_id)!;
        return <ScoreEditor key={r.block_id} block={b} result={r} segments={review.segments.filter((s) => s.block_id === r.block_id)}
          onChange={(next) => setEdits((e) => ({ ...e, [r.block_id]: next }))} onRunDistance={(i, m) => p.runDistance(r.block_id, i, m)} />;
      })}
      {!!review?.results.length && <CopyForWodUp workout={d.workout} results={review.results} segments={review.segments} />}
      {p.activityPicker}
    </>;
    footer = <>
      {/* Capped so the footer leaves room to scroll the score cards at the largest text size. */}
      {unready && <Copy kind="small" tone="muted" align="center" maxScale={1.5}>Choose Rx or Scaled for each score to save.</Copy>}
      <Button title="Save class" icon="checkmark-done" size="lg" busy={busy} disabled={unready} onPress={save} />
    </>;
  } else if (status === "resting_after") {
    const left = restLeft(part, block, now);
    const restClock = <SessionClock text={formatClock(left)} caption={`Rest · ${restLine(next)}`} progress={block.rest_after_seconds ? left / block.rest_after_seconds : null}
      trigger={index} compact={grid} accessibilityLabel={`${formatClock(left)} of rest left, ${restLine(next)}`}>
      <Copy kind="small" tone="muted" align="center" maxScale={grid ? 1.5 : undefined}>{block.label} is done. Your clock keeps going with the phone locked.</Copy>
    </SessionClock>;
    pinned = grid ? restClock : null;
    body = <>
      {!grid && restClock}
      <Row gap={12}>
        <View style={{ flex: 1 }}><Button title="−15 s" variant="secondary" size="lg" disabled={busy} {...half("−15 s")} onPress={() => p.act((r, w, at) => adjustRest(r, w, -15_000, at))} /></View>
        <View style={{ flex: 1 }}><Button title="+15 s" variant="secondary" size="lg" disabled={busy} {...half("+15 s")} onPress={() => p.act((r, w, at) => adjustRest(r, w, 15_000, at))} /></View>
      </Row>
    </>;
    footer = <Button title={next ? `Start ${next.label} now` : "End rest"} icon="play-skip-forward" size="lg" disabled={busy} onPress={() => p.act(endRest)} />;
  } else if (status === "pending" || status === "skipped") {
    body = <>
      <Copy kind="heading">{partTitle(block)}</Copy>
      {!!block.instructions?.length && <WorkoutInstructions instructions={block.instructions} title="Coach notes" />}
      <Card compact>{block.exercises.map((e, i) => <ListRow key={i} title={e.name} detail={[e.segment === "buy_in" ? "Buy-in, once" : null, prescriptionLine(e)].filter(Boolean).join(" · ")} />)}</Card>
    </>;
    footer = <>
      <BigTap title={`Start ${block.label}`} hint="Counts down 3, 2, 1, then starts this part’s clock" disabled={busy} onPress={() => p.act(startPart)} />
      <Button title={`Skip ${block.label}`} variant="ghost" disabled={busy} onPress={() => p.act(skipPart)} />
    </>;
  } else if (part.kind === "sets") {
    const e = step?.exercise;
    body = <>
      {setRest > 0 && <RestTimer remaining={setRest} onAdd={() => p.timer("rest", setRest + 15)} onSkip={() => p.timer("rest", 0)} />}
      {setPart && e ? <>
        <Copy kind="label" tone="muted">{`${setName} · round ${step.round_index} of ${rounds}`}</Copy>
        <Copy kind="heading">{e.name}</Copy>
        <Copy tone="muted">{prescriptionLine({ ...e, sets: null, rest_seconds: null })}</Copy>
        {!!e.instructions && <Copy kind="small" tone="muted">{e.instructions}</Copy>}
        {e.duration_seconds != null && (holdLeft != null
          ? <SessionClock text={formatClock(holdLeft)} caption={`${e.name} · time left`} progress={holdLeft / e.duration_seconds}
            trigger={d.cursor} compact={false} accessibilityLabel={`${formatClock(holdLeft)} left`}><View /></SessionClock>
          : <Button title={`Start ${formatClock(e.duration_seconds)} timer`} icon="timer-outline" variant="secondary" size="lg" disabled={busy} onPress={() => p.timer("interval")} />)}
      </> : <Copy tone="muted">{block.label} is running.</Copy>}
    </>;
    footer = setPart ? <>
      <BigTap title={`Done · ${setName}`} hint="Logs this set as prescribed" disabled={busy} onPress={() => logSet(true)} />
      <Row gap={12}>
        <View style={{ flex: 1 }}><Button title="Skip set" variant="secondary" disabled={busy} {...half("Skip set")} onPress={() => logSet(false)} /></View>
        {d.undo.length > 0 && d.actuals.at(-1)?.block_id === block.id && <View style={{ flex: 1 }}><Button title="Undo" icon="arrow-undo-outline" variant="secondary" disabled={busy} {...half("Undo")} onPress={p.undo} /></View>}
      </Row>
    </> : <Button title={`End ${block.label}`} variant="secondary" disabled={busy} onPress={() => p.act(endPart)} />;
  } else {
    const clock = partClock(part, block, now);
    const paused = status === "paused";
    const buyingIn = (part.kind === "amrap" || part.kind === "for_time") && hasBuyIn(block) && part.buy_in_done_at == null;
    const counting = part.kind === "amrap" || (part.kind === "for_time" && rounds > 1);
    const format = timedFormatFor(block);
    const intervalMoves = clock.interval && format && format.mode !== "for_time"
      ? movesFor(format as IntervalFormat, block, clock.interval.index).map((i) => moveText(block.exercises[i], 1)).join(" + ") : null;
    const clockCard = <SessionClock text={formatClock(clock.seconds)} caption={[partTitle(block), clock.interval?.label].filter(Boolean).join(" · ")}
      phase={clock.interval && format?.mode === "work_rest" ? (clock.interval.phase === "work" ? "Work" : "Rest") : null}
      progress={clock.progress} trigger={part.round_taps.length} compact={grid}
      accessibilityLabel={`${formatClock(clock.seconds)} ${clock.direction}`}>
      {counting && !buyingIn && <Copy kind="numeric" align="center" maxScale={grid ? 1.5 : undefined} style={{ fontSize: 40, lineHeight: 46 }}
        accessibilityLabel={`${roundText(part.round_taps.length)} done`}>{roundText(part.round_taps.length)}</Copy>}
      {!!intervalMoves && <Copy kind="label" align="center">{intervalMoves}</Copy>}
    </SessionClock>;
    pinned = grid ? clockCard : null;
    body = <>
      {!grid && clockCard}
      {invalidLoad && <Notice error>Enter a weight from 0 to 2000 before logging a round.</Notice>}
      {paused && <Notice tone="warning">{block.label} is paused. Only this part’s clock stopped.</Notice>}
      {buyingIn ? <Copy kind="label">Buy-in · {buyInMove(block)}</Copy>
        : counting && <Copy tone="muted">This round · {roundMoves(block)}</Copy>}
      {counting && !buyingIn && block.exercises.some((e) => e.load != null || e.relative_load || e.load_options?.length) &&
        <Button title="Round weights" variant="secondary" icon="barbell-outline" onPress={() => setWeights(true)} />}

    </>;
    footer = <>
      {visibleRuns(part, block).map((i) => <RunChoice key={i} label={moveText(block.exercises[i], 1)}
        value={env(i)} disabled={busy} onChange={(v) => chooseRun(i, v)} />)}
      {buyingIn ? <BigTap title="Buy-in done" hint="Starts counting rounds" disabled={busy || paused} onPress={() => p.act(buyInDone)} />
        : counting ? <BigTap title="+1 round" hint={`Now ${roundText(part.round_taps.length)}`} disabled={busy || paused || invalidLoad} onPress={() => p.act(tapRound)} />
        : null}
      {part.kind === "for_time" && <Button title="Done · stop the clock" icon="stop-circle-outline" size="lg" disabled={busy} onPress={() => p.act(endPart)} />}
      <Row gap={12}>
        <View style={{ flex: 1 }}><Button title={paused ? "Resume" : "Pause"} icon={paused ? "play" : "pause"} variant="secondary" disabled={busy}
          {...half(paused ? "Resume" : "Pause")} onPress={() => p.act(paused ? resumePart : pausePart)} /></View>
        {(part.round_taps.length > 0 || part.buy_in_done_at != null) && <View style={{ flex: 1 }}>
          <Button title="Undo" icon="arrow-undo-outline" variant="secondary" disabled={busy} {...half("Undo")}
            accessibilityHint={part.round_taps.length ? "Removes the last round" : "Takes back the buy-in"} onPress={() => p.act(undoTap)} /></View>}
      </Row>
    </>;
  }

  const leadIn = status === "lead_in" || (part.started_at != null && now < part.started_at + 1500 && leadInDone !== part.started_at && part.lead_in_ms != null);
  return (
    <Screen native back title={over ? d.workout.title : status === "resting_after" ? "Rest" : partTitle(block)} subtitle={status === "resting_after" ? restLine(next) : over ? undefined : d.workout.title}
      action={<IconButton icon="ellipsis-horizontal" label="More class actions" onPress={() => setMore(true)} />}
      footer={<>{!!p.error && <Notice error>{p.error}</Notice>}{footer}</>} pinned={pinned ?? undefined}>
      {body}
      {!over && run.parts.length > 1 && <>
        <SectionHeader title="Today’s parts" />
        <Card compact>{run.parts.map((x, i) => <ListRow key={x.block_id} title={partTitle(d.workout.blocks[i])}
          detail={i < index ? (x.skipped ? "Skipped" : "Done") : i === index ? (status === "resting_after" ? "Done" : "Now") : status === "resting_after" && i === index + 1 ? "Up next" : undefined} />)}</Card>
      </>}
      {leadIn && part.started_at != null && <LeadIn until={part.started_at} label={partTitle(block)}
        onSkip={() => p.act(skipLeadIn)} onDone={() => setLeadInDone(part.started_at!)} />}
      <Sheet visible={weights} onClose={() => setWeights(false)} title="Round weights">
        <Copy tone="muted">Used for your next round. Earlier rounds keep their weights.</Copy>
        {block.exercises.map((e, i) => {
          if (e.segment || (e.load == null && !e.relative_load && !e.load_options?.length)) return null;
          const recorded = d.class_loads?.[block.id]?.[i];
          const key = `${block.id}:${i}`;
          const unit = loadUnits[key] ?? recorded?.load_unit ?? e.load_unit ?? "kg";
          const value = loadText[key] ?? String(recorded ? recorded.load ?? "" : e.load ?? "");
          return <View key={key} style={{ gap: 12 }}>
            <Copy kind="label">{e.name}</Copy><Copy kind="small" tone="muted">{prescriptionLine(e)}</Copy>
            <Field label={`${e.name} weight`} numeric value={value} onChange={(v) => {
              setLoadText((t) => ({ ...t, [key]: v }));
              if (v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 2000))
                p.roundLoad?.(block.id, i, v.trim() ? Number(v) : null, unit);
            }} />
            <Segmented<"kg" | "lb"> label={`${e.name} unit`} value={unit} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]}
              onChange={(u) => { setLoadUnits((t) => ({ ...t, [key]: u })); if (value.trim() && Number.isFinite(Number(value))) p.roundLoad?.(block.id, i, Number(value), u); }} />
            {e.load_options?.map((option, n) => <Button key={n} title={`${option.load} ${option.load_unit}${option.label ? ` · ${option.label}` : ""}`} variant="secondary"
              onPress={() => { setLoadText((t) => ({ ...t, [key]: String(option.load) })); setLoadUnits((t) => ({ ...t, [key]: option.load_unit })); p.roundLoad?.(block.id, i, option.load, option.load_unit, option.load_convention ?? "total"); }} />)}
          </View>;
        })}
      </Sheet>
      <Sheet visible={more} onClose={() => setMore(false)} title="Class">
        <ListRow icon="book-outline" title="Coach notes" onPress={() => { setMore(false); setInstructions(true); }} />
        {!over && (status === "running" || status === "paused") && part.kind !== "sets" &&
          <ListRow icon="stop-circle-outline" title={`End ${block.label} now`} disabled={busy} onPress={() => { setMore(false); endEarly(); }} />}
        {!over && status !== "resting_after" && <ListRow icon="play-skip-forward-outline" title={`Skip ${block.label}`} disabled={busy} onPress={() => { setMore(false); p.act(skipPart); }} />}
        {!over && <ListRow icon="flag-outline" title="End class" detail="Ends this part, skips the rest, and goes to your scores" disabled={busy}
          onPress={() => { setMore(false); p.act(endClass); }} />}
        <ListRow icon="trash-outline" title="Discard this session" destructive disabled={busy} onPress={() => { setMore(false); p.discard(); }} />
      </Sheet>
      <Sheet visible={instructions} onClose={() => setInstructions(false)} title="Coach notes">
        <WorkoutInstructions instructions={d.workout.instructions} title="Coach notes" />
        {d.workout.blocks.map((b) => <View key={b.id} style={{ gap: 4 }}>
          <Copy kind="label">{partTitle(b)}</Copy>
          {b.exercises.map((e, i) => <Copy key={i} kind="small" tone="muted">{`${e.name} · ${prescriptionLine(e)}`}</Copy>)}
        </View>)}
      </Sheet>
    </Screen>
  );
}

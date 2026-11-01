import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { durationLabel } from "@/lib/timed-execution";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useColors } from "@/components/ui";
import { dayAdjustments } from "@/lib/day-adjustments";
import { AdjustTraining } from "./adjust-training";
import { programSessionStates, programSessionKey } from "@/lib/program-session-identity";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { Button, Copy, Empty, ListGroup, ListRow, Notice, WeekStrip } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { sessionsQuery, sessionReadStartedAt } from "@/lib/session-query";
import { dateInTimezone } from "@/lib/training";
import { missingProgressParents, loadProgressAncestry, selectProgressSessions } from "@/lib/progress-selection";
import { weekSummary, weekDays } from "@/lib/week-strip";
import { formatPlanDate, nextPlannedSession } from "@/lib/plan-presentation";
import type { Program, ScheduledSession } from "@/lib/models";

/** The top of Train: today's session (or what to do instead), this week and a quiet coach entry. */
export function TrainToday() {
  const { api, owner, enrollment, enrollmentQuery, isCurrentAccount, storage } = useTraining();
  const offline = useOfflineTraining();
  const c = useColors();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjust, setAdjust] = useState<{ program: Program; session?: ScheduledSession } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const retrying = useRef(false);
  const starting = useRef(false);
  const enabled = !!enrollment?.enrolled;
  const profile = useQuery({ queryKey: [owner, "profile", enrollment?.generation], queryFn: api.profile, enabled });
  const programs = useQuery({ queryKey: [owner, "programs", enrollment?.generation], queryFn: api.programs, enabled });
  const sessions = useQuery(sessionsQuery(api, owner, enrollment));
  const generation = enrollment?.generation ?? 0;
  const receipts = useQuery({ queryKey: [owner, "day-adjustments", generation], queryFn: () => dayAdjustments(storage, owner, generation).list(), enabled });
  const parents = missingProgressParents(offline.state.history, sessions.data ?? [], generation);
  const needsAncestry = parents.length > 0 && selectProgressSessions(offline.state.history, sessions.data ?? [], generation).requiresAncestry;
  const ancestry = useQuery({
    queryKey: [owner, "progress-ancestry", generation, parents],
    queryFn: ({ signal }) => loadProgressAncestry(parents, api.session, generation, 64, [
      ...offline.state.history.filter((h) => h.generation === generation).flatMap((h) => h.synced_id ? [h.synced_id] : []),
      ...(sessions.data?.filter((s) => s.generation === generation).map((s) => s.id) ?? []),
    ], { signal }),
    enabled: enabled && needsAncestry,
  });
  const progress = selectProgressSessions(offline.state.history, sessions.data ?? [], generation, ancestry.data?.records);
  const recordedSessions = progress.sessions;
  const ancestryReady = !needsAncestry || ancestry.data?.complete === true;
  const timezone = profile.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = dateInTimezone(new Date(), timezone);
  // Any recorded work (even partial) settles a planned session here, matching the plan list below.
  const recordedStates = programSessionStates(sessions.data, offline.state.history, enrollment?.generation ?? 0, sessionReadStartedAt(sessions.data));
  const isDone = (p: Program, s: ScheduledSession) => recordedStates.has(programSessionKey(p.id, s.id)!);
  const live = programs.data?.filter((p) => !p.schedule_state?.archived_at) ?? [];
  const activePrograms = live.filter((p) => p.status === "ready" && p.schedule_state?.status !== "paused");
  const planned = activePrograms.flatMap((p) => p.sessions.filter((s) => s.date === date && !isDone(p, s)).map((s) => ({ program: p, session: s })))[0];
  const doneToday = activePrograms.some((p) => p.sessions.some((s) => s.date === date && isDone(p, s)));
  const next = nextPlannedSession(activePrograms, date, isDone);
  const missedPlan = activePrograms.find(p => p.sessions.some(s => s.date < date && !isDone(p, s)));
  const missed = activePrograms.flatMap((p) => p.sessions.filter((s) => s.date < date && !isDone(p, s)));
  const dayOf = (iso: string | undefined) => {
    const at = new Date(iso ?? "");
    return Number.isNaN(at.getTime()) ? [] : [dateInTimezone(at, timezone)];
  };
  const week = weekDays(
    date,
    new Set(ancestryReady ? recordedSessions.filter((s) => s.recorded).flatMap((s) => dayOf(s.started_at)) : []),
    new Set(activePrograms.flatMap((p) => p.sessions.map((s) => s.date)))
  );
  const summaryReady = sessions.data !== undefined && offline.ready && !offline.error && profile.data !== undefined && ancestryReady;
  const summary = summaryReady ? weekSummary(date, progress.effective.map(s => s.request), timezone) : null;
  const coach = useQuery({ queryKey: [owner, "coach-history", generation], queryFn: () => api.coachHistory(), enabled });
  useFocusRefresh([coach], { enabled });
  const suggestion = [...(coach.data?.messages ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).find(message => message.state === "completed" && message.assistant_message)?.assistant_message?.replace(/[#*_`]/g, "").split(/\n/)[0];
  async function retryToday() {
    if (retrying.current || !isCurrentAccount() || !storage.isCurrent()) return;
    retrying.current = true;
    setRetryBusy(true);
    try {
      const checked = await enrollmentQuery.refetch();
      if (!isCurrentAccount() || !storage.isCurrent() || checked.error ||
        !checked.data?.enrolled || checked.data.generation !== enrollment?.generation) return;
      await Promise.all([profile.refetch(), programs.refetch(), sessions.refetch()]);
    } finally {
      retrying.current = false;
      setRetryBusy(false);
    }
  }
  async function start(program: Program, session: ScheduledSession) {
    if (starting.current || !offline.store || !offline.ready || program.schedule_state?.status === "paused") return;
    starting.current = true;
    setBusy(true);
    setError("");
    try {
      await offline.store.start(
        { ...session.workout, id: session.workout.id ?? session.id, generation: program.generation, revision: session.workout.version ?? 1 },
        { program_id: program.id, program_revision: program.revision, program_session_id: session.id },
        Crypto.randomUUID()
      );
      router.push("/training");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }
  const active = offline.state.active;
  const recorded = active?.actuals.filter((a) => a.completed).length ?? 0;
  const library = <Button title="Browse workouts" onPress={() => router.push("/(tabs)/library")} />;
  const buildPlan = (pathname: "/build-plan" | "/profile") => (
    <Button title="Build a plan" icon="add" size="lg" onPress={() =>
      router.push(pathname === "/profile" ? { pathname, params: { return_to: "build-plan" } } : pathname)} />
  );
  let hero: { title: string; detail: string; cover?: string | null; meta?: string[]; action?: ReactNode; extra?: ReactNode };
  if (active) {
    hero = { title: active.workout.title, cover: active.workout.source_thumbnail_url, detail: `${recorded} ${recorded === 1 ? "set" : "sets"} recorded so far · saved on this device`,
      action: <Button title="Resume" icon="play" size="lg" onPress={() => router.push("/training")} /> };
  } else if (planned) {
    const workout = planned.session.workout;
    hero = { title: workout.title, cover: workout.source_thumbnail_url, detail: "",
      meta: [durationLabel(workout), workout.blocks?.length ? `${workout.blocks.reduce((n, block) => n + block.exercises.length, 0)} exercises` : null, ...(workout.equipment_required?.slice(0, 1) ?? [])]
        .filter((x): x is string => !!x),
      action: <>
        {!offline.ready && <Copy kind="small" tone="muted">Getting this device ready to record your session…</Copy>}
        <Button title="Start" icon="play" size="lg" disabled={!offline.ready} busy={busy} onPress={() => { void start(planned.program, planned.session); }} />
        <Button title="Adjust today" size="sm" secondary onPress={() => { setAdjust(planned); setAdjustOpen(true); }} />
      </> };
  } else if (!profile.data) {
    hero = { title: "Set up your training", detail: "Add your goal and free days, then build a plan that fits your week.",
      action: buildPlan("/profile") };
  } else if (doneToday) {
    hero = { title: "Done for today", detail: "Rest and recovery are part of the plan.", action: library };
  } else if (activePrograms.length) {
    hero = { title: "Rest day", extra: library,
      detail: next ? `Next up: ${formatPlanDate(next.s.date)} · ${next.s.workout.title}` : "No more sessions planned. Build your next plan when you’re ready." };
  } else if (live.some((p) => p.schedule_state?.status === "paused")) {
    hero = { title: "Your plan is paused", detail: "Your upcoming sessions are saved below. Plan your return when you’re ready.", extra: library };
  } else if (live.length) {
    hero = { title: "Your plan needs a quick review", detail: "Check it below before you start training.", extra: library };
  } else {
    hero = { title: "No plan yet", detail: "Build a plan around your goal, equipment and free days.", action: buildPlan("/build-plan") };
  }
  const heroCard = (
    <View style={{ gap: 12 }}>
      {!!hero.cover && <Image source={{ uri: hero.cover }} contentFit="cover" accessibilityLabel={`${hero.title} cover`} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 20, backgroundColor: c.surface }} />}
      <Copy kind="heading">{hero.title}</Copy>
      {!!hero.detail && <Copy tone="muted">{hero.detail}</Copy>}
      {!!hero.meta?.length && <Copy kind="small" tone="muted">{hero.meta.join(" · ")}</Copy>}
      {hero.action}
      {hero.extra}
    </View>
  );
  if (!enabled)
    return (<>
      {active && heroCard}
      <QueryState loading={enrollmentQuery.isPending && !enrollment} error={enrollmentQuery.error} retry={() => { void enrollmentQuery.refetch(); }}>
        <Empty
          icon="sunny-outline"
          mark
          title="Start saving workouts"
          description={enrollment?.generation
            ? "Your earlier Workouts data was removed. You can explicitly start fresh with the same Håfa account."
            : "Save workout inspiration now. Add goals and a training plan later."}
          action={<Button title="Join Workouts" onPress={() => router.push("/onboarding")} />}
        />
      </QueryState>
    </>);
  return (
    <>
      {!!offline.error && <Notice error>{offline.error}</Notice>}
      <WeekStrip days={week} />
      {/* Saved device training stays resumable even when the service can't be reached. */}
      {active && heroCard}
      <QueryState
        hasData={profile.data !== undefined && programs.data !== undefined && sessions.data !== undefined}
        loading={retryBusy || profile.isPending || programs.isPending || sessions.isPending}
        error={enrollmentQuery.error ?? profile.error ?? programs.error ?? sessions.error}
        retry={() => { void retryToday(); }}
      >
        {!active && heroCard}
        <View style={{ gap: 12 }}>
          {!!missed.length && <Copy kind="small" tone="warning">
            {missed.length} earlier {missed.length === 1 ? "session needs" : "sessions need"} a new date. Tap one below to move it or
            train it now; nothing moves on its own.
          </Copy>}
          {!!missedPlan && !active && <Button title="Missed sessions" secondary onPress={() => { setAdjust({ program: missedPlan }); setAdjustOpen(true); }} />}
          {!ancestryReady && <>
            <Copy kind="small" tone="muted">Done-day checkmarks are paused while we check your corrected results. Your saved results are in Progress.</Copy>
            {!ancestry.isPending && <Button title="Check again" variant="secondary" size="sm" inline onPress={() => { void ancestry.refetch(); }} />}
          </>}
        </View>
      </QueryState>
      {receipts.data?.map(receipt => <Button key={receipt.proposal.id} title={`Review saved adjustment · ${receipt.program.title}`} secondary
        onPress={() => { setAdjust({ program: receipt.program, session: receipt.session }); setAdjustOpen(true); }} />)}
      {!!receipts.error && <><Notice error>Could not restore saved adjustments.</Notice><Button title="Retry saved adjustments" secondary onPress={() => void receipts.refetch()} /></>}
      <ListGroup>
        <ListRow icon="chatbubble-ellipses-outline" title="Ask your coach" detailLines={1} detail={suggestion ?? "Questions about training or a change to your plan"} onPress={() => router.push("/coach")} />

      </ListGroup>
      {/* One tappable card: the numbers, a visible "See progress" and a chevron. */}
      <Pressable accessibilityRole="button" accessibilityLabel={summary ? `This week: ${summary.sessions} sessions, ${summary.minutes} minutes, ${summary.streak} day streak. See progress` : "This week. See progress"}
        onPress={() => router.navigate("/(tabs)/progress")}
        style={({ pressed }) => ({ gap: 12, padding: 16, borderRadius: 16, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Copy kind="subheading">This week</Copy>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Copy kind="small" color={c.accentText}>See progress</Copy>
            <Ionicons name="chevron-forward" size={16} color={c.accentText} />
          </View>
        </View>
        {summary ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 24 }}>
          {([[summary.sessions, "Sessions"], [summary.minutes, "Minutes"], [summary.streak, "Day streak"]] as const).map(([value, label]) => <View key={label} style={{ minWidth: 76, gap: 2 }}>
            <Copy kind="numericSmall" style={{ fontSize: 28, lineHeight: 34 }}>{value}</Copy><Copy kind="small" tone="muted">{label}</Copy>
          </View>)}
        </View> : <Copy kind="small" tone="muted">Your totals appear once your history loads.</Copy>}
      </Pressable>
      <ListGroup>
        <ListRow icon="add-circle-outline" title="Log an activity you did" detail="A run, a class or anything outside Håfa" onPress={() => router.push("/activity")} />
      </ListGroup>
      {adjust && <AdjustTraining key={`${adjust.program.id}:${adjust.session?.id ?? "missed"}`} visible={adjustOpen} onClose={() => setAdjustOpen(false)} program={programs.data?.find(p => p.id === adjust.program.id) ?? adjust.program} session={adjust.session} />}
      {!!error && <Notice error>{error}</Notice>}
    </>
  );
}

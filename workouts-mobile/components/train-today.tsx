import { programSessionStates, programSessionKey } from "@/lib/program-session-identity";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { Button, Card, Chip, ChipRow, Copy, Empty, ListGroup, ListRow, Notice, WeekStrip } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { sessionsQuery, sessionReadStartedAt } from "@/lib/session-query";
import { dateInTimezone } from "@/lib/training";
import { missingProgressParents, loadProgressAncestry, selectProgressSessions } from "@/lib/progress-selection";
import { weekDays } from "@/lib/week-strip";
import { formatPlanDate, nextPlannedSession } from "@/lib/plan-presentation";
import type { Program, ScheduledSession } from "@/lib/models";

/** The top of Train: today's session (or what to do instead), this week and a quiet coach entry. */
export function TrainToday() {
  const { api, owner, enrollment, enrollmentQuery, isCurrentAccount, storage } = useTraining();
  const offline = useOfflineTraining();
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
  const recordedSessions = selectProgressSessions(offline.state.history, sessions.data ?? [], generation, ancestry.data?.records).sessions;
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
  const library = <Button title="Pick a workout from your library" variant="secondary" size="sm" inline onPress={() => router.push("/(tabs)/library")} />;
  const buildPlan = (pathname: "/build-plan" | "/profile") => (
    <Button title="Build a plan" icon="add" size="lg" onPress={() =>
      router.push(pathname === "/profile" ? { pathname, params: { return_to: "build-plan" } } : pathname)} />
  );
  let hero: { title: string; detail: string; meta?: string[]; action?: ReactNode; extra?: ReactNode };
  if (active) {
    hero = { title: active.workout.title, detail: `${recorded} ${recorded === 1 ? "set" : "sets"} recorded so far · saved on this device`,
      action: <Button title="Resume" icon="play" size="lg" onPress={() => router.push("/training")} /> };
  } else if (planned) {
    const workout = planned.session.workout;
    hero = { title: workout.title, detail: planned.session.purpose,
      meta: [workout.estimated_minutes ? `${workout.estimated_minutes} min` : null, ...(workout.equipment_required?.slice(0, 2) ?? [])]
        .filter((x): x is string => !!x),
      action: <>
        {!offline.ready && <Copy kind="small" tone="muted">Getting this device ready to record your session…</Copy>}
        <Button title="Start" icon="play" size="lg" disabled={!offline.ready} busy={busy} onPress={() => { void start(planned.program, planned.session); }} />
      </> };
  } else if (!profile.data) {
    hero = { title: "Set up your training", detail: "Add your goal and free days, then build a plan that fits your week.",
      action: buildPlan("/profile"), extra: library };
  } else if (doneToday) {
    hero = { title: "Done for today", detail: "Nice work. Rest and recovery are part of the plan." };
  } else if (activePrograms.length) {
    hero = { title: "Rest day", extra: library,
      detail: next ? `Next up: ${formatPlanDate(next.s.date)} · ${next.s.workout.title}` : "No more sessions planned. Build your next plan when you’re ready." };
  } else if (live.some((p) => p.schedule_state?.status === "paused")) {
    hero = { title: "Your plan is paused", detail: "Your upcoming sessions are saved below. Plan your return when you’re ready.", extra: library };
  } else if (live.length) {
    hero = { title: "Your plan needs a quick review", detail: "Check it below before you start training.", extra: library };
  } else {
    hero = { title: "No plan yet", detail: "Build a plan around your goal, equipment and free days.", action: buildPlan("/build-plan"), extra: library };
  }
  const heroCard = (
    <Card tone="hero">
      <Copy kind="title">{hero.title}</Copy>
      <Copy tone="muted">{hero.detail}</Copy>
      {!!hero.meta?.length && <ChipRow wrap>{hero.meta.map((m) => <Chip key={m} label={m} />)}</ChipRow>}
      {hero.action}
      {hero.extra}
    </Card>
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
      {/* Saved device training stays resumable even when the service can't be reached. */}
      {active && heroCard}
      <QueryState
        hasData={profile.data !== undefined && programs.data !== undefined && sessions.data !== undefined}
        loading={retryBusy || profile.isPending || programs.isPending || sessions.isPending}
        error={enrollmentQuery.error ?? profile.error ?? programs.error ?? sessions.error}
        retry={() => { void retryToday(); }}
      >
        {!active && heroCard}
        <Card compact>
          <WeekStrip days={week} />
          {!!missed.length && <Copy kind="small" tone="warning">
            {missed.length} earlier {missed.length === 1 ? "session needs" : "sessions need"} a new date. Tap one below to move it or
            train it now; nothing moves on its own.
          </Copy>}
          {!ancestryReady && <>
            <Copy kind="small" tone="muted">Done-day checkmarks are paused while we check your corrected results. Your saved results are in Progress.</Copy>
            {!ancestry.isPending && <Button title="Check again" variant="secondary" size="sm" inline onPress={() => { void ancestry.refetch(); }} />}
          </>}
        </Card>
      </QueryState>
      <ListGroup>
        <ListRow icon="chatbubble-ellipses-outline" title="Adjust with coach" detail="Short on time, sore or not feeling 100%?" onPress={() => router.push("/coach")} />
        <ListRow icon="walk-outline" title="Log an activity you did" onPress={() => router.push("/activity")} />
      </ListGroup>
      {!!error && <Notice error>{error}</Notice>}
    </>
  );
}

import { completedProgramSessions, programSessionKey } from "@/lib/program-session-identity";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  AccountButton,
  Button,
  Card,
  Chip,
  ChipRow,
  Copy,
  Empty,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  SectionHeader,
  WeekStrip,
} from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { sessionsQuery, sessionReadStartedAt } from "@/lib/session-query";
import { dateInTimezone } from "@/lib/training";
import { weekDays } from "@/lib/week-strip";
import { goalLabels, type Program, type ScheduledSession } from "@/lib/models";
export default function Today() {
  const { api, owner, enrollment, enrollmentQuery, isCurrentAccount, storage } = useTraining();
  const offline = useOfflineTraining();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const retrying = useRef(false);
  const enabled = !!enrollment?.enrolled;
  const profile = useQuery({ queryKey: [owner, "profile", enrollment?.generation], queryFn: api.profile, enabled });
  const programs = useQuery({ queryKey: [owner, "programs", enrollment?.generation], queryFn: api.programs, enabled });
  const sessions = useQuery(sessionsQuery(api, owner, enrollment));
  const timezone = profile.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = dateInTimezone(new Date(), timezone);
  const completed = completedProgramSessions(sessions.data, offline.state.history, enrollment?.generation ?? 0, sessionReadStartedAt(sessions.data));
  const activePrograms = programs.data?.filter((p) => p.status === "ready" && p.schedule_state?.status !== "paused");
  const planned = activePrograms
    ?.flatMap((p) =>
      p.sessions.filter((s) => s.date === date && !completed.has(programSessionKey(p.id, s.id)!)).map((s) => ({ program: p, session: s }))
    )[0];
  const missed = activePrograms?.flatMap((p) => p.sessions.filter((s) =>
    s.date < date && !completed.has(programSessionKey(p.id, s.id)!))) ?? [];
  const dayOf = (iso: string | undefined) => {
    const at = new Date(iso ?? "");
    return Number.isNaN(at.getTime()) ? [] : [dateInTimezone(at, timezone)];
  };
  const week = weekDays(
    date,
    new Set([
      ...(sessions.data ?? []).flatMap((s) => dayOf(s.started_at)),
      ...offline.state.history.flatMap((h) => dayOf(h.request?.started_at)),
    ]),
    new Set(activePrograms?.flatMap((p) => p.sessions.map((s) => s.date)) ?? [])
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
    if (!offline.store || !offline.ready || program.schedule_state?.status === "paused") return;
    setBusy(true);
    try {
      await offline.store.start(
        {
          ...session.workout,
          id: session.workout.id ?? session.id,
          generation: program.generation,
          revision: session.workout.version ?? 1,
        },
        { program_id: program.id, program_revision: program.revision, program_session_id: session.id },
        Crypto.randomUUID()
      );
      router.push("/training");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = offline.state.active;
  const recorded = active?.actuals.filter((a) => a.completed).length ?? 0;
  const workout = planned?.session.workout;
  const meta = [
    workout?.estimated_minutes ? `${workout.estimated_minutes} min` : null,
    ...(workout?.equipment_required?.slice(0, 2) ?? []),
  ].filter((x): x is string => !!x);
  return (
    <Screen
      title="Håfa adai."
      eyebrow={new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: profile.data?.timezone,
      }).format(new Date())}
      action={<AccountButton />}
    >
      {active && (
        <Card tone="hero">
          <Copy kind="caption" tone="accent">
            Your saved session
          </Copy>
          <Copy kind="heading">{active.workout.title}</Copy>
          <Copy tone="muted">
            {recorded} recorded {recorded === 1 ? "set" : "sets"} · your progress is on this device.
          </Copy>
          <Button title="Resume session" icon="play" size="lg" onPress={() => router.push("/training")} />
        </Card>
      )}
      {!!offline.error && <Notice error>{offline.error}</Notice>}
      {programs.data?.some((p) => p.schedule_state?.status === "paused") && (
        <Card tone="sunken" compact>
          <Copy kind="subheading">Your paused plan stays saved.</Copy>
          <Copy kind="small" tone="muted">
            Review your current comfortable baseline before returning to the future queue.
          </Copy>
          <Button title="Review paused training plans" variant="secondary" size="sm" inline onPress={() => router.push("/(tabs)/plan")} />
        </Card>
      )}
      {!enabled ? (
        <QueryState
          loading={enrollmentQuery.isPending && !enrollment}
          error={enrollmentQuery.error}
          retry={() => {
            void enrollmentQuery.refetch();
          }}
        >
          <Empty
            icon="sunny-outline"
            mark
            title="Start saving workouts"
            description={
              enrollment?.generation
                ? "Your earlier Workouts data was removed. You can explicitly start fresh with the same Håfa account."
                : "Save workout inspiration now. Add goals and a training plan later."
            }
            action={<Button title="Join Workouts" onPress={() => router.push("/onboarding")} />}
          />
        </QueryState>
      ) : (
        <>
          <QueryState
            loading={retryBusy || profile.isPending || programs.isPending || sessions.isPending}
            error={enrollmentQuery.error ?? profile.error ?? programs.error ?? sessions.error}
            retry={() => {
              void retryToday();
            }}
          >
            {!!missed.length && <Card tone="sunken" compact>
              <Copy kind="subheading">{missed.length} earlier {missed.length === 1 ? "session needs" : "sessions need"} a new date</Copy>
              <Copy tone="muted">Keep your recorded work. Review what you missed and choose when to return; sessions are never stacked automatically.</Copy>
              <Button title="Review missed sessions" secondary onPress={() => router.push("/(tabs)/plan")} />
            </Card>}
            {!profile.data ? (
              <Empty
                icon="person-outline"
                title="Give training a foundation"
                description="Set your goal and availability so your plan can fit your life."
                action={<><Button title="Save a workout" onPress={() => router.push("/capture")} /><Button title="Set up a training plan" secondary onPress={() => router.push({ pathname: "/profile", params: { return_to: "build-plan" } })} /></>}
              />
            ) : (
              <>
                {(
                  <Card tone={active ? "plain" : "hero"}>
                    <Copy kind="caption" tone="accent">
                      {planned ? "Today’s session" : "Your training focus"}
                    </Copy>
                    <Copy kind={active ? "heading" : "title"}>{workout?.title ?? goalLabels[profile.data.primary_goal]}</Copy>
                    <Copy tone="muted">
                      {planned?.session.purpose ??
                        "No session planned today. Rest counts too, or pick a saved workout when you feel like moving."}
                    </Copy>
                    {!!meta.length && (
                      <ChipRow wrap>
                        {meta.map((m) => (
                          <Chip key={m} label={m} />
                        ))}
                      </ChipRow>
                    )}
                    {planned && !active ? (
                      <Button
                        title="Start this session"
                        icon="play"
                        size="lg"
                        disabled={!offline.ready}
                        busy={busy}
                        onPress={() => {
                          void start(planned.program, planned.session);
                        }}
                      />
                    ) : (
                      <Button title="Open your plan" variant="secondary" onPress={() => router.push("/(tabs)/plan")} />
                    )}
                  </Card>
                )}
                <SectionHeader title="This week" action={{ label: "Plan", onPress: () => router.push("/(tabs)/plan") }} />
                <Card compact>
                  <WeekStrip days={week} />
                </Card>
              </>
            )}
          </QueryState>
          <ListGroup>
            <ListRow
              icon="chatbubble-ellipses-outline"
              title="Adjust today with your coach"
              detail="Not feeling 100%, short on time, or played last night?"
              onPress={() => router.push("/coach")}
            />
            <ListRow icon="walk-outline" title="Log an activity you did" onPress={() => router.push("/activity")} />
            <ListRow icon="albums-outline" title="Pick a saved workout" onPress={() => router.push("/(tabs)/library")} />
            <ListRow icon="add-circle-outline" title="Add a workout" detail="From a link, screenshot or your own notes" onPress={() => router.push("/capture")} />
          </ListGroup>
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
      <Copy kind="small" tone="muted" align="center">
        Free during beta. Completed work counts; rest is part of the plan.
      </Copy>
    </Screen>
  );
}

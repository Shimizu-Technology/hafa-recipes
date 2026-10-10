import { completedProgramSessions, programSessionKey } from "@/lib/program-session-identity";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { AccountButton, Button, Card, Copy, Empty, Notice, Screen, useColors } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { dateInTimezone } from "@/lib/training";
import { goalLabels, type Program, type ScheduledSession } from "@/lib/models";
export default function Today() {
  const { api, owner, enrollment, enrollmentQuery } = useTraining();
  const offline = useOfflineTraining();
  const c = useColors();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = !!enrollment?.enrolled;
  const profile = useQuery({ queryKey: [owner, "profile", enrollment?.generation], queryFn: api.profile, enabled });
  const programs = useQuery({ queryKey: [owner, "programs", enrollment?.generation], queryFn: api.programs, enabled });
  const sessions = useQuery({ queryKey: [owner, "sessions", enrollment?.generation], queryFn: api.sessions, enabled });
  const date = dateInTimezone(new Date(), profile.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const completed = completedProgramSessions(sessions.data, offline.state.history);
  const planned = programs.data
    ?.filter((p) => p.status === "ready" && p.schedule_state?.status !== "paused")
    .flatMap((p) =>
      p.sessions.filter((s) => s.date === date && !completed.has(programSessionKey(p.id, s.id)!)).map((s) => ({ program: p, session: s }))
    )[0];
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
  return (
    <Screen
      title="Make time for you."
      subtitle={new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: profile.data?.timezone,
      }).format(new Date())}
      action={<AccountButton />}
    >
      {offline.state.active && (
        <Card tone="hero">
          <Copy kind="label" color="#DDEBCB">
            YOUR SAVED SESSION
          </Copy>
          <Copy kind="heading" color="#FFFFFF">
            {offline.state.active.workout.title}
          </Copy>
          <Copy color="#E1EDD9">
            {offline.state.active.actuals.filter((a) => a.completed).length} recorded {offline.state.active.actuals.filter((a) => a.completed).length === 1 ? "set" : "sets"} · your progress is on this
            device.
          </Copy>
          <Button title="Resume session" secondary onPress={() => router.push("/training")} />
        </Card>
      )}
      {!!offline.error && <Notice error>{offline.error}</Notice>}
      {programs.data?.some((p) => p.schedule_state?.status === "paused") && (
        <Card>
          <Copy kind="heading">Your paused plan stays saved.</Copy>
          <Copy>Review your current comfortable baseline before returning to the future queue.</Copy>
          <Button title="Review paused training plans" secondary onPress={() => router.push("/(tabs)/plan")} />
        </Card>
      )}
      {enabled && (
        <Button title="Log activity I completed" icon="walk-outline" onPress={() => router.push("/activity")} />
      )}
      {enabled && <Button title="Talk through today with my coach" secondary onPress={() => router.push("/coach")} />}
      {!enabled ? (
        <>
          <QueryState
            loading={enrollmentQuery.isPending && !enrollment}
            error={enrollmentQuery.error}
            retry={() => {
              void enrollmentQuery.refetch();
            }}
          >
            <Empty
              icon="sunny-outline"
              title="Start with your real life"
              description={
                enrollment?.generation
                  ? "Your earlier Workouts data was removed. You can explicitly start fresh with the same Håfa account."
                  : "Tell us your goals, equipment and realistic schedule. Your Recipes data stays separate."
              }
              action={<Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
            />
          </QueryState>
        </>
      ) : (
        <>
          <QueryState
            loading={profile.isPending}
            error={profile.error}
            retry={() => {
              void profile.refetch();
            }}
          >
            {!profile.data ? (
              <Empty
                icon="person-outline"
                title="Give training a foundation"
                description="Set your goal and availability so your plan can fit your life."
                action={<Button title="Set up my profile" onPress={() => router.push("/onboarding")} />}
              />
            ) : (
              <Card tone="hero">
                <Copy kind="label" color="#DDEBCB">
                  {planned ? "TODAY’S SESSION" : "YOUR TRAINING FOCUS"}
                </Copy>
                <Copy kind="title" color="#FFFFFF">
                  {planned?.session.workout.title ?? goalLabels[profile.data.primary_goal]}
                </Copy>
                <Copy color="#E1EDD9">
                  {planned?.session.purpose ??
                    "A good training week includes recovery. Choose a saved workout or review your plan."}
                </Copy>
                {planned && !offline.state.active ? (
                  <Button
                    title="Start this session"
                    secondary
                    disabled={!offline.ready}
                    busy={busy}
                    onPress={() => {
                      void start(planned.program, planned.session);
                    }}
                  />
                ) : (
                  <Button title="Open your plan" secondary onPress={() => router.push("/(tabs)/plan")} />
                )}
              </Card>
            )}
          </QueryState>
          {programs.error && <Notice error>{programs.error.message}</Notice>}
          <Button
            title="Choose a saved workout"
            secondary
            icon="fitness-outline"
            onPress={() => router.push("/(tabs)/library")}
          />
          <Button title="Add a workout" icon="add" onPress={() => router.push("/capture")} />
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
      <Copy kind="small" color={c.muted}>
        Free during beta. Completed work counts; rest is part of the plan.
      </Copy>
    </Screen>
  );
}

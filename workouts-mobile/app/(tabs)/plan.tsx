import { completedProgramSessions, programSessionKey } from "@/lib/program-session-identity";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { AccountButton, Button, Card, Copy, Empty, Field, Notice, Screen, useColors } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import type { Program, ScheduledSession } from "@/lib/models";
export default function Plan() {
  const { api, owner, enrollment } = useTraining();
  const offline = useOfflineTraining();
  const cache = useQueryClient();
  const c = useColors();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const actuals = useQuery({
    queryKey: [owner, "sessions", enrollment?.generation],
    queryFn: api.sessions,
    enabled: !!enrollment?.enrolled,
  });
  const completed = completedProgramSessions(actuals.data, offline.state.history);
  const q = useQuery({
    queryKey: [owner, "programs", enrollment?.generation],
    queryFn: api.programs,
    enabled: !!enrollment?.enrolled,
  });
  async function start(p: Program, s: ScheduledSession) {
    if (!offline.store || !offline.ready || p.schedule_state?.status === "paused") return;
    setBusy(true);
    setError("");
    try {
      await offline.store.start(
        { ...s.workout, id: s.workout.id ?? s.id, generation: p.generation, revision: s.workout.version ?? 1 },
        { program_id: p.id, program_revision: p.revision, program_session_id: s.id },
        Crypto.randomUUID()
      );
      router.push("/training");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function move(p: Program, s: ScheduledSession) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + "T12:00:00Z").getTime())) {
      setError("Use a valid date in YYYY-MM-DD format.");
      return;
    }
    if (p.sessions.some((other) => other.id !== s.id && other.date === date)) {
      setError("That day already has a planned session. Choose another day to preserve recovery.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api.updateProgram({
        ...p,
        sessions: p.sessions.map((item) => (item.id === s.id ? { ...item, date } : item)),
      });
      cache.setQueryData<Program[]>([owner, "programs", enrollment?.generation], (old) =>
        old?.map((item) => (item.id === p.id ? saved : item))
      );
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      title="A week that works."
      subtitle="Training and recovery, with room for real life."
      action={<AccountButton />}
    >
      {enrollment?.enrolled && (
        <Button title="Build a training program" icon="add" onPress={() => router.push("/build-plan")} />
      )}
      {offline.state.active && <Button title="Resume active session" onPress={() => router.push("/training")} />}
      {!enrollment?.enrolled ? (
        <Empty
          icon="calendar-outline"
          title="Set your training foundation"
          description="Join Workouts before saving a program."
          action={<Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
        />
      ) : (
        <QueryState
          loading={q.isPending}
          error={q.error}
          retry={() => {
            void q.refetch();
          }}
        >
          {!q.data?.length ? (
            <Empty
              icon="calendar-outline"
              title="Give your plan a foundation"
              description="Review your goal, equipment and available days before building a program."
              action={<Button title="Review training profile" secondary onPress={() => router.push("/profile")} />}
            />
          ) : (
            q.data.map((p) => (
              <Card key={p.id}>
                <Copy kind="heading">{p.title}</Copy>
                <Button
                  title="Chat about this plan"
                  secondary
                  onPress={() =>
                    router.push({ pathname: "/coach", params: { program_id: p.id, revision: String(p.revision) } })
                  }
                />
                {p.schedule_state?.status === "paused" && (
                  <>
                    <Notice>
                      This plan is paused. Its future queue remains saved in order and needs a fresh return review
                      before training resumes.
                    </Notice>
                    <Button
                      title="Review returning to this plan"
                      secondary
                      onPress={() =>
                        router.push({ pathname: "/coach", params: { program_id: p.id, revision: String(p.revision) } })
                      }
                    />
                    {p.schedule_state.paused_sessions?.map((s, index) => (
                      <Card key={`paused:${s.id}`}>
                        <Copy kind="small">
                          Paused · original order {index + 1} · {s.date}
                        </Copy>
                        <Copy kind="heading">{s.workout.title}</Copy>
                        <Copy>{s.purpose}</Copy>
                      </Card>
                    ))}
                  </>
                )}
                <Button
                  title="Share this program"
                  disabled={p.schedule_state?.status === "paused"}
                  secondary
                  onPress={() => router.push({ pathname: "/share", params: { id: p.id, kind: "program" } })}
                />
                {p.status !== "ready" && (
                  <Notice>
                    {p.questions.join(" ") || p.warnings.join(" ") || "Review this plan before training."}
                  </Notice>
                )}
                {p.status !== "ready" && (
                  <Button
                    title="Review this plan for my current constraints"
                    secondary
                    onPress={() => router.push({ pathname: "/review-plan", params: { program_id: p.id } })}
                  />
                )}
                {p.sessions.map((s) => (
                  <Card key={s.id}>
                    <Copy kind="small" color={c.muted}>
                      {s.date}
                    </Copy>
                    <Copy kind="heading">{s.workout.title}</Copy>
                    <Copy>{s.purpose}</Copy>
                    {!!s.workout.estimated_minutes && (
                      <Copy color={c.muted}>{s.workout.estimated_minutes} minutes planned</Copy>
                    )}
                    <Button
                      title="Start session"
                      disabled={
                        !!offline.state.active ||
                        !offline.ready ||
                        p.status !== "ready" ||
                        p.schedule_state?.status === "paused"
                      }
                      busy={busy}
                      onPress={() => {
                        void start(p, s);
                      }}
                    />
                    <Button
                      title="Move this session"
                      secondary
                      disabled={busy || completed.has(programSessionKey(p.id, s.id)!) || p.schedule_state?.status === "paused"}
                      onPress={() => {
                        setEditing(programSessionKey(p.id, s.id));
                        setDate(s.date);
                      }}
                    />
                    {editing === programSessionKey(p.id, s.id) && (
                      <>
                        <Field label="New date · YYYY-MM-DD" value={date} onChange={setDate} />
                        <Notice>
                          This changes future scheduling only. Recorded training and its original prescription stay
                          intact.
                        </Notice>
                        <Button
                          title="Save new date"
                          busy={busy}
                          onPress={() => {
                            void move(p, s);
                          }}
                        />
                        <Button title="Keep original date" secondary onPress={() => setEditing(null)} />
                      </>
                    )}
                  </Card>
                ))}
              </Card>
            ))
          )}
        </QueryState>
      )}
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}

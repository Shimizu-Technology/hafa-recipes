import { completedProgramSessions, programSessionKey } from "@/lib/program-session-identity";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  AccountButton,
  Button,
  Card,
  Chip,
  Copy,
  Empty,
  Field,
  Grow,
  IconButton,
  ListRow,
  Notice,
  Row,
  Screen,
  Sheet,
  useColors,
} from "@/components/ui";
import { radii } from "@/constants/theme";
import { View } from "react-native";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import type { Program, ScheduledSession } from "@/lib/models";
function DateBadge({ date, done }: { date: string; done: boolean }) {
  const c = useColors();
  const at = new Date(`${date}T12:00:00Z`);
  const valid = !Number.isNaN(at.getTime());
  return (
    <View
      style={{
        width: 52,
        paddingVertical: 6,
        borderRadius: radii.md,
        alignItems: "center",
        backgroundColor: done ? c.action : c.actionSoft,
      }}
    >
      <Copy kind="caption" color={done ? c.onAction : c.onActionSoft}>
        {valid ? new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(at) : "Day"}
      </Copy>
      <Copy kind="numericSmall" color={done ? c.onAction : c.onActionSoft}>
        {valid ? at.getUTCDate() : "–"}
      </Copy>
    </View>
  );
}
export default function Plan() {
  const { api, owner, enrollment } = useTraining();
  const offline = useOfflineTraining();
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<Program | null>(null);
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
      action={
        <Row gap={8}>
          {enrollment?.enrolled && (
            <IconButton icon="add" label="Build a training program" variant="primary" onPress={() => router.push("/build-plan")} />
          )}
          <AccountButton />
        </Row>
      }
    >
      {offline.state.active && (
        <Card tone="hero" compact>
          <Copy kind="subheading">{offline.state.active.workout.title}</Copy>
          <Button title="Resume active session" icon="play" onPress={() => router.push("/training")} />
        </Card>
      )}
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
              description="Review your goal, equipment and available days, then build a program that fits your week."
              action={
                <>
                  <Button title="Build a training program" icon="add" onPress={() => router.push("/build-plan")} />
                  <Button title="Review training profile" variant="ghost" onPress={() => router.push("/profile")} />
                </>
              }
            />
          ) : (
            q.data.map((p) => (
              <Card key={p.id}>
                <Row gap={12} align="flex-start">
                  <Grow>
                    <Copy kind="heading">{p.title}</Copy>
                    <Copy kind="small" tone="muted">
                      {p.sessions.length} {p.sessions.length === 1 ? "session" : "sessions"} planned
                    </Copy>
                  </Grow>
                  {p.schedule_state?.status === "paused" ? (
                    <Chip label="Paused" tone="accent" />
                  ) : p.status !== "ready" ? (
                    <Chip label="Needs review" tone="accent" />
                  ) : null}
                  <IconButton icon="ellipsis-horizontal" label={`More actions for ${p.title}`} size={40} onPress={() => setMenu(p)} />
                </Row>
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
                      <Card key={`paused:${s.id}`} tone="sunken" compact>
                        <Copy kind="small" tone="muted">
                          Paused · original order {index + 1} · {s.date}
                        </Copy>
                        <Copy kind="subheading">{s.workout.title}</Copy>
                        <Copy kind="small">{s.purpose}</Copy>
                      </Card>
                    ))}
                  </>
                )}
                {p.status !== "ready" && (
                  <>
                    <Notice tone="warning">
                      {p.questions.join(" ") || p.warnings.join(" ") || "Review this plan before training."}
                    </Notice>
                    <Button
                      title="Review this plan for my current constraints"
                      secondary
                      onPress={() => router.push({ pathname: "/review-plan", params: { program_id: p.id } })}
                    />
                  </>
                )}
                {p.sessions.map((s) => {
                  const key = programSessionKey(p.id, s.id);
                  const done = completed.has(key!);
                  return (
                    <View key={s.id} style={{ gap: 10 }}>
                      <Row gap={14} align="flex-start">
                        <DateBadge date={s.date} done={done} />
                        <Grow style={{ gap: 2 }}>
                          <Copy kind="subheading">{s.workout.title}</Copy>
                          <Copy kind="small" tone="muted">
                            {s.purpose}
                            {s.workout.estimated_minutes ? ` · ${s.workout.estimated_minutes} minutes planned` : ""}
                          </Copy>
                        </Grow>
                      </Row>
                      {done && (
                        <Copy kind="small" tone="success">
                          Done. Nice work.
                        </Copy>
                      )}
                      {(
                        <Row gap={10}>
                          <Button
                            title="Start session"
                            icon="play"
                            size="sm"
                            variant={done ? "secondary" : "primary"}
                            inline
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
                          {!done && <Button
                            title="Move this session"
                            variant="ghost"
                            size="sm"
                            inline
                            disabled={busy || p.schedule_state?.status === "paused"}
                            onPress={() => {
                              setEditing(key);
                              setDate(s.date);
                            }}
                          />}
                        </Row>
                      )}
                      {editing === key && (
                        <Card tone="sunken" compact>
                          <Field label="New date · YYYY-MM-DD" value={date} onChange={setDate} />
                          <Copy kind="small" tone="muted">
                            This changes future scheduling only. Recorded training and its original prescription stay
                            intact.
                          </Copy>
                          <Row gap={10}>
                            <Button
                              title="Save new date"
                              size="sm"
                              inline
                              busy={busy}
                              onPress={() => {
                                void move(p, s);
                              }}
                            />
                            <Button title="Keep original date" variant="ghost" size="sm" inline onPress={() => setEditing(null)} />
                          </Row>
                        </Card>
                      )}
                    </View>
                  );
                })}
              </Card>
            ))
          )}
        </QueryState>
      )}
      {!!error && <Notice error>{error}</Notice>}
      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.title ?? "Plan"}>
        {!!menu && (
          <>
            <ListRow
              icon="chatbubble-ellipses-outline"
              title="Chat about this plan"
              onPress={() => {
                setMenu(null);
                router.push({ pathname: "/coach", params: { program_id: menu.id, revision: String(menu.revision) } });
              }}
            />
            <ListRow
              icon="share-outline"
              title="Share this program"
              disabled={menu.schedule_state?.status === "paused"}
              onPress={() => {
                setMenu(null);
                router.push({ pathname: "/share", params: { id: menu.id, kind: "program" } });
              }}
            />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

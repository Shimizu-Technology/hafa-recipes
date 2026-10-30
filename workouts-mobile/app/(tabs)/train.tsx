import { programSessionStates, programSessionKey } from "@/lib/program-session-identity";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
  SectionHeader,
  Sheet,
  useColors,
} from "@/components/ui";
import { radii } from "@/constants/theme";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CalendarDate } from "@/components/calendar-date";
import { TrainToday } from "@/components/train-today";
import { PrescriptionPreview } from "@/components/program-preview";
import { isISODate } from "@/lib/sharing";
import { dateInTimezone } from "@/lib/training";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { sessionsQuery, sessionReadStartedAt } from "@/lib/session-query";
import type { Program, ScheduledSession } from "@/lib/models";
import { programMoveError } from "@/lib/plans";
import { formatPlanDate, nextPlannedSession } from "@/lib/plan-presentation";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { groupPlanWeeks } from "@/lib/plan-weeks";
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
/** One planned session: date, title and time at a glance. Tapping opens its actions. */
function SessionRow({ date, title, detail, tone, done, onPress, testID }: {
  date: string; title: string; detail: string; tone: "muted" | "success" | "warning"; done: boolean; onPress(): void; testID: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${formatPlanDate(date)}. ${title}. ${detail}`}
      accessibilityHint="Opens this session"
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 56, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.7 : 1 })}
    >
      <DateBadge date={date} done={done} />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Copy kind="label" numberOfLines={2}>{title}</Copy>
        <Copy kind="small" tone={tone} numberOfLines={1}>{detail}</Copy>
      </View>
      <Ionicons name={done ? "checkmark-circle" : "chevron-forward"} size={done ? 22 : 18} color={done ? c.success : c.muted} />
    </Pressable>
  );
}
/** A week heading that folds its sessions away: "Week 2 · Oct 27 – Nov 2 · 1 of 3 done". */
function WeekHeader({ label, summary, open, onPress }: { label: string; summary: string; open: boolean; onPress(): void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${summary}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Copy kind="label">{label}</Copy>
        <Copy kind="small" tone="muted">{summary}</Copy>
      </View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={c.muted} />
    </Pressable>
  );
}
export default function Plan() {
  const { api, owner, enrollment, isCurrentAccount, storage } = useTraining();
  const offline = useOfflineTraining();
  const cache = useQueryClient();
  const colors = useColors();
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<Program | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = useMemo(() => ({ moving: false, archiving: false, maintaining: false, starting: false }),
    [owner, enrollment?.generation, storage, offline.store]);
  const liveScope = useRef<typeof scope | null>(null);
  function current() { return liveScope.current === scope && isCurrentAccount() && storage.isCurrent(); }
  const [renaming, setRenaming] = useState<{ program: Program; title: string } | null>(null);
  const [removing, setRemoving] = useState<{ program: Program; session: ScheduledSession } | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const editor = useMemo(() => ({ key: editing }), [scope, editing]);
  const [readinessNeeded, setReadinessNeeded] = useState<typeof editor | null>(null);
  const committedEditor = useRef<typeof editor | null>(null);
  useLayoutEffect(() => { committedEditor.current = editor; setReadinessNeeded(null);
    return () => { if (committedEditor.current === editor) committedEditor.current = null; };
  }, [editor]);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ programId: string; sessionId: string } | null>(null);
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});
  useLayoutEffect(() => {
    liveScope.current = scope;
    setRenaming(null); setRemoving(null); setMenu(null); setEditing(null); setDate(""); setInspecting(null); setOpened(null); setError(""); setBusy(false);
    return () => { if (liveScope.current === scope) liveScope.current = null; };
  }, [scope]);
  const actuals = useQuery(sessionsQuery(api, owner, enrollment));
  const statuses = programSessionStates(actuals.data, offline.state.history, enrollment?.generation ?? 0, sessionReadStartedAt(actuals.data));
  const profile = useQuery({ queryKey: [owner, "profile", enrollment?.generation], queryFn: api.profile, enabled: !!enrollment?.enrolled });
  const today = dateInTimezone(new Date(), profile.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const q = useQuery({
    queryKey: [owner, "programs", enrollment?.generation],
    queryFn: api.programs,
    enabled: !!enrollment?.enrolled,
  });
  const shownPrograms = q.data?.filter((p) => !!p.schedule_state?.archived_at === (view === "archived"));
  const freshness = useFocusRefresh([q, actuals, profile], { enabled: !!enrollment?.enrolled });
  // Only the next session still to train gets the filled Start button.
  const next = nextPlannedSession(q.data, today, (p, s) => statuses.has(programSessionKey(p.id, s.id)!));
  const openProgram = opened ? q.data?.find((p) => p.id === opened.programId) : undefined;
  const openSession = openProgram?.sessions.find((s) => s.id === opened?.sessionId);
  function sessionState(p: Program, s: ScheduledSession) {
    const key = programSessionKey(p.id, s.id)!;
    const status = statuses.get(key);
    const missed = s.date < today && !status && p.schedule_state?.status !== "paused";
    return { key, status, done: status === "completed", missed };
  }
  async function archive(p: Program, archived: boolean) {
    if (busy || scope.archiving || scope.moving || scope.maintaining || scope.starting || !current()) return;
    scope.archiving = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api.archiveProgram(p, archived);
      if (!current()) return;
      cache.setQueryData<Program[]>([owner, "programs", enrollment?.generation], (old) =>
        old?.map((item) => item.id === p.id && item.revision <= saved.revision ? saved : item));
      await cache.invalidateQueries({ queryKey: [owner, "programs", enrollment?.generation] });
      if (!current()) return;
      setMenu(null);
      setEditing(null);
      const latest = cache.getQueryData<Program[]>([owner, "programs", enrollment?.generation])?.find((item) => item.id === p.id) ?? saved;
      setView(latest.schedule_state?.archived_at ? "archived" : "active");
    } catch (e) {
      if (current()) {
        setError((e as Error).message);
        if ((e as { status?: number }).status === 409) {
          setMenu(null);
          void cache.invalidateQueries({ queryKey: [owner, "programs", enrollment?.generation] });
        }
      }
    } finally {
      scope.archiving = false;
      if (current()) setBusy(false);
    }
  }
  async function start(p: Program, s: ScheduledSession) {
    if (busy || scope.starting || scope.moving || scope.archiving || scope.maintaining || !current() || !offline.store || !offline.ready || p.schedule_state?.status === "paused") return;
    scope.starting = true;
    setBusy(true);
    setError("");
    try {
      await offline.store.start(
        { ...s.workout, id: s.workout.id ?? s.id, generation: p.generation, revision: s.workout.version ?? 1 },
        { program_id: p.id, program_revision: p.revision, program_session_id: s.id },
        Crypto.randomUUID()
      );
      if (current()) { setOpened(null); router.push("/training"); }
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      scope.starting = false;
      if (current()) setBusy(false);
    }
  }
  async function move(p: Program, s: ScheduledSession) {
    if (busy || scope.moving || scope.archiving || scope.maintaining || scope.starting || !current()) return;
    if (statuses.has(programSessionKey(p.id, s.id)!)) {
      setError("Recorded sessions keep their original date. Start a separate session to train again.");
      return;
    }
    if (!isISODate(date) || date < today) {
      setError("Choose today or a future date.");
      return;
    }
    if (q.data?.some((otherProgram) => otherProgram.status === "ready" && otherProgram.schedule_state?.status !== "paused" && otherProgram.sessions.some((other) =>
      (otherProgram.id !== p.id || other.id !== s.id) && other.date === date))) {
      setError("That day already has a planned session. Choose another day to preserve recovery.");
      return;
    }
    scope.moving = true;
    setBusy(true);
    setError("");
    setReadinessNeeded(null);
    try {
      const saved = await api.updateProgram({
        ...p,
        sessions: p.sessions.map((item) => (item.id === s.id ? { ...item, date } : item)),
      });
      if (!current()) return;
      cache.setQueryData<Program[]>([owner, "programs", enrollment?.generation], (old) =>
        old?.map((item) => (item.id === p.id && item.revision <= saved.revision ? saved : item))
      );
      setEditing(null);
      setOpened(null);
    } catch (e) {
      if (current()) {
        setError(programMoveError(e));
        if (committedEditor.current === editor && (e as { status?: number }).status === 409 &&
            (e as { detail?: string }).detail === "Confirm readiness before applying a training change") setReadinessNeeded(editor);
      }
    } finally {
      scope.moving = false;
      if (current()) setBusy(false);
    }
  }
  async function confirmReadiness() {
    const generation = enrollment?.generation;
    if (!enrollment?.enrolled || !generation || !current() || readinessNeeded !== editor || committedEditor.current !== editor || busy ||
        scope.maintaining || scope.moving || scope.archiving || scope.starting) return;
    scope.maintaining = true; setBusy(true); setError("");
    try {
      await api.setReadiness("ready", generation);
      if (current() && committedEditor.current === editor) { setReadinessNeeded(null); setError(""); }
    } catch (e) { if (current() && committedEditor.current === editor) setError(e instanceof Error ? e.message : "Could not confirm readiness. Try again."); }
    finally { scope.maintaining = false; if (current()) setBusy(false); }
  }
  function removable(p: Program, session: ScheduledSession) {
    const todayNow = dateInTimezone(new Date(), profile.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    const local = offline.store?.snapshot();
    const activeSource = local?.active?.source;
    return offline.ready && p.status === "ready" && !p.schedule_state?.archived_at && p.schedule_state?.status !== "paused" && session.date > todayNow &&
      !statuses.has(programSessionKey(p.id, session.id)!) &&
      !(activeSource && "program_id" in activeSource && activeSource.program_id === p.id && activeSource.program_session_id === session.id) &&
      !(local?.history ?? offline.state.history).some(item => item.generation === p.generation && item.request.program_id === p.id && item.request.program_session_id === session.id);
  }
  async function maintain(p: Program, action: "rename" | "remove", title = "", session?: ScheduledSession) {
    if (busy || scope.maintaining || scope.moving || scope.archiving || scope.starting || !current()) return;
    if (p.schedule_state?.archived_at || p.schedule_state?.status === "paused") { setError("Restore or review this plan before changing it."); return; }
    const latest = cache.getQueryData<Program[]>([owner, "programs", enrollment?.generation])?.find(item => item.id === p.id);
    if (!latest || latest.revision !== p.revision) { setError("This plan changed. Reopen its actions before making another change."); return; }
    if (action === "rename" && (!title.trim() || title.trim().length > 200)) { setError("Use a plan name from 1 to 200 characters."); return; }
    if (action === "remove" && (!session || !removable(p, session))) { setError("Only future sessions without active or recorded work can be removed."); return; }
    scope.maintaining = true; setBusy(true); setError("");
    try {
      const saved = await api.updateProgram(action === "rename" ? { ...p, title: title.trim() } :
        { ...p, sessions: p.sessions.filter(item => item.id !== session!.id) });
      if (!current()) return;
      cache.setQueryData<Program[]>([owner, "programs", enrollment?.generation], old =>
        old?.map(item => item.id === p.id && item.revision <= saved.revision ? saved : item));
      setRenaming(null); setRemoving(null); setMenu(null); setEditing(null);
    } catch (e) {
      if (!current()) return;
      setError(programMoveError(e));
      if ((e as { status?: number }).status === 409) {
        setRenaming(null); setRemoving(null); setMenu(null);
        void cache.invalidateQueries({ queryKey: [owner, "programs", enrollment?.generation] });
      }
    } finally { scope.maintaining = false; if (current()) setBusy(false); }
  }
  const sheet = openProgram && openSession ? { p: openProgram, s: openSession, ...sessionState(openProgram, openSession) } : null;
  const removingOpen = !!sheet && removing?.program.id === sheet.p.id && removing.session.id === sheet.s.id;
  function closeSession() {
    if (busy) return;
    setOpened(null); setEditing(null); setRemoving(null);
  }
  /** Why a session can't start right now; shown beside the disabled button. */
  function startBlocked(p: Program) {
    if (offline.state.active) return "Finish your current session first.";
    if (p.status !== "ready") return "Review this plan before training.";
    if (p.schedule_state?.status === "paused") return "This plan is paused. Plan your return first.";
    if (!offline.ready) return "Getting this device ready to record your session…";
    return "";
  }
  function startButton(p: Program, s: ScheduledSession, status: string | undefined) {
    const again = status === "partial" || status === "completed";
    const blocked = startBlocked(p);
    return (
      <>
        {!!blocked && <Copy kind="small" tone="muted">{blocked}</Copy>}
        <Button
          title={again ? "Start session again" : "Start session"}
          icon="play"
          variant={status === "completed" ? "secondary" : "primary"}
          disabled={!!blocked}
          busy={busy}
          onPress={() => {
            void start(p, s);
          }}
        />
      </>
    );
  }
  const archivedCount = q.data?.filter((p) => !!p.schedule_state?.archived_at).length ?? 0;
  // Loading and errors show once, in the Today section above.
  const loaded = !!enrollment?.enrolled && q.data !== undefined && actuals.data !== undefined && profile.data !== undefined;
  function openSessionSheet(p: Program, s: ScheduledSession) {
    if (current()) { setError(""); setEditing(null); setRemoving(null); setOpened({ programId: p.id, sessionId: s.id }); }
  }
  function sessionRows(p: Program, sessions: ScheduledSession[]) {
    return sessions.map((s, index) => {
      const { status, done, missed } = sessionState(p, s);
      const minutes = s.workout.estimated_minutes ? `${s.workout.estimated_minutes} min` : null;
      // Today's session starts from the top of the screen; a later one can start here.
      const inlineStart = next?.p.id === p.id && next.s.id === s.id && s.date !== today && !offline.state.active;
      return (
        <View key={s.id} style={{ gap: 8, paddingBottom: inlineStart ? 8 : 0, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
          <SessionRow
            testID={`plan-session-${s.id}`}
            date={s.date}
            title={s.workout.title}
            done={done}
            tone={done ? "success" : missed ? "warning" : "muted"}
            detail={done ? "Done · nice work" : status === "partial" ? "Partly recorded" : status === "skipped" ? "No sets recorded"
              : missed ? "Missed · choose a new date or train it now" : [s.date === today ? "Today" : null, minutes, s.purpose].filter(Boolean).join(" · ")}
            onPress={() => openSessionSheet(p, s)}
          />
          {inlineStart && startButton(p, s, status)}
        </View>
      );
    });
  }
  function planWeeks(p: Program) {
    const weeks = groupPlanWeeks(p.sessions, today);
    const firstAhead = weeks.find((w) => !w.past && w.key !== "other");
    const secondAhead = weeks.find((w) => !w.past && w.key !== "other" && w !== firstAhead);
    return weeks.map((w) => {
      const states = w.items.map((s) => sessionState(p, s));
      const done = states.filter((x) => x.done).length;
      const missedCount = states.filter((x) => x.missed).length;
      const key = `${p.id}:${w.key}`;
      // Past weeks fold away unless something there still needs a new date.
      const open = openWeeks[key] ?? (w.key === "other" || missedCount > 0 || w === firstAhead || (firstAhead?.current === true && w === secondAhead));
      const summary = [`${w.items.length} ${w.items.length === 1 ? "session" : "sessions"}`,
        done ? `${done} done` : null, missedCount ? `${missedCount} missed` : null].filter(Boolean).join(" · ");
      return (
        <View key={w.key} style={{ gap: 4 }}>
          <WeekHeader label={w.label} summary={summary} open={open} onPress={() => setOpenWeeks((f) => ({ ...f, [key]: !open }))} />
          {open && <View>{sessionRows(p, w.items)}</View>}
        </View>
      );
    });
  }
  return (
    <Screen
      title="Train"
      subtitle={new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: profile.data?.timezone }).format(new Date())}
      refreshing={freshness.refreshing}
      onRefresh={enrollment?.enrolled ? freshness.onRefresh : undefined}
      action={<AccountButton />}
    >
      <ListRow icon="stats-chart-outline" title="History & progress"
        detail="Sessions, activities, records and your week" onPress={() => router.push("/history-progress")} />
      <TrainToday />
      {loaded && (!!shownPrograms?.length || view === "archived" || archivedCount > 0) && (
        <SectionHeader
          title={view === "archived" ? "Archived plans" : "Your plans"}
          action={view === "archived" ? { label: "Current plans", onPress: () => setView("active") }
            : archivedCount ? { label: `Archived (${archivedCount})`, onPress: () => setView("archived") } : undefined}
        />
      )}
      {loaded && view === "active" && <Button title="Build a new plan" secondary onPress={() => router.push("/build-plan")} />}
      {loaded && view === "archived" && !shownPrograms?.length && (
        <Empty icon="archive-outline" title="No archived plans" description="Plans you archive stay here with their original instructions and history." />
      )}
      {loaded && shownPrograms?.map((p) => {
        const total = p.sessions.length + (p.schedule_state?.paused_sessions?.length ?? 0);
        const status = p.schedule_state?.archived_at ? "Archived" : p.schedule_state?.status === "paused" ? "Paused" : p.status !== "ready" ? "Needs review" : null;
        return (
          <Card key={p.id}>
            <Row gap={12} align="flex-start">
              <Grow>
                <Copy kind="heading">{p.title}</Copy>
                <Copy kind="small" tone="muted">{total} {total === 1 ? "session" : "sessions"}</Copy>
              </Grow>
              {!!status && <Chip label={status} />}
              <IconButton icon="ellipsis-horizontal" label={`More actions for ${p.title}`} size={44} onPress={() => setMenu(p)} />
            </Row>
            {p.schedule_state?.archived_at && <>
              <Notice>Archived. Workout instructions and recorded training stay saved. Restoring keeps the original dates;
                a paused plan stays paused until you plan your return.</Notice>
              <Button title="Restore plan" secondary busy={busy} onPress={() => void archive(p, false)} />
            </>}
            {p.schedule_state?.status === "paused" && !p.schedule_state.archived_at && <>
              <Notice>Paused. Your upcoming sessions stay saved in order. Check in with your coach before picking back up.</Notice>
              <Button title="Plan your return with coach" secondary
                onPress={() => router.push({ pathname: "/coach", params: { program_id: p.id, revision: String(p.revision) } })} />
            </>}
            {p.schedule_state?.paused_sessions?.map((s) => (
              <View key={`paused:${s.id}`} style={{ gap: 6 }}>
                <Row gap={14}>
                  <DateBadge date={s.date} done={false} />
                  <Grow style={{ gap: 2 }}>
                    <Copy kind="label">{s.workout.title}</Copy>
                    <Copy kind="small" tone="muted">On hold · {s.purpose}</Copy>
                  </Grow>
                </Row>
                <Button title={inspecting === `held:${p.id}:${s.id}` ? "Hide workout" : "Show workout"} variant="ghost" size="sm" inline
                  onPress={() => setInspecting(inspecting === `held:${p.id}:${s.id}` ? null : `held:${p.id}:${s.id}`)} />
                {inspecting === `held:${p.id}:${s.id}` && <PrescriptionPreview workout={s.workout} />}
              </View>
            ))}
            {p.status !== "ready" && !p.schedule_state?.archived_at && <>
              <Notice tone="warning">{p.questions.join(" ") || p.warnings.join(" ") || "Review this plan before training."}</Notice>
              <Button title="Review this plan" secondary onPress={() => router.push({ pathname: "/review-plan", params: { program_id: p.id } })} />
            </>}
            {planWeeks(p)}
          </Card>
        );
      })}
      {!!error && <Notice error>{error}</Notice>}
      <Copy kind="small" tone="muted" align="center">Free during beta. Completed work counts; rest is part of the plan.</Copy>
      <Sheet visible={!!sheet} onClose={closeSession} title={removingOpen ? "Remove planned session?" : sheet?.s.workout.title ?? "Session"}>
        {!!sheet && (removingOpen ? <>
          <Copy>Remove {sheet.s.workout.title} on {formatPlanDate(sheet.s.date)} from {sheet.p.title}?</Copy>
          <Copy kind="small">This removes the future plan entry. Your saved workout, other planned days and recorded training stay available.</Copy>
          {!!error && <Notice error>{error}</Notice>}
          <Button title="Remove planned session" variant="destructive" busy={busy} onPress={() => void maintain(removing!.program, "remove", "", removing!.session)} />
          <Button title="Keep planned session" secondary disabled={busy} onPress={() => setRemoving(null)} />
        </> : <>
          <Copy kind="small" tone="muted">
            {[formatPlanDate(sheet.s.date), sheet.s.purpose, sheet.s.workout.estimated_minutes ? `${sheet.s.workout.estimated_minutes} minutes planned` : null].filter(Boolean).join(" · ")}
          </Copy>
          {sheet.done && <Copy kind="small" tone="success">Done. Nice work.</Copy>}
          {sheet.status === "partial" && <Notice>Partially recorded. Your saved sets stay in Progress; starting again creates a separate session.</Notice>}
          {sheet.status === "skipped" && <Notice>No completed sets recorded. Its original date stays in history; start a separate session to train again.</Notice>}
          {sheet.missed && <Notice tone="warning">This date has passed. Move this session to a day that works, or train it now. Other sessions keep their dates.</Notice>}
          {!!error && <Notice error>{error}</Notice>}
          {editing === sheet.key && !sheet.status ? <>
            <CalendarDate label="New date" value={date} min={today} disabled={busy}
              onChange={value => { if (current() && committedEditor.current === editor && editor.key === sheet.key) setDate(value ?? ""); }} />
            <Copy kind="small" tone="muted">
              Choose today or a future date. The workout instructions stay unchanged;
              recorded sessions keep their original dates.
            </Copy>
            {readinessNeeded === editor && <>
              <Copy kind="small">Confirm you’re ready to train today, then save the new date. Your entered date stays here.</Copy>
              <Button title="I’m ready to train today" secondary busy={busy} onPress={() => void confirmReadiness()} />
            </>}
            <Button title="Save new date" busy={busy} onPress={() => { void move(sheet.p, sheet.s); }} />
            <Button title="Keep original date" variant="ghost" disabled={busy} onPress={() => setEditing(null)} />
          </> : <>
            {startButton(sheet.p, sheet.s, sheet.status)}
            {!sheet.status && sheet.p.schedule_state?.status === "paused" &&
              <Copy kind="small" tone="muted">Paused plans keep their dates until you plan your return.</Copy>}
            {!sheet.status && <Button
              title={sheet.missed ? "Choose a new date" : "Move this session"}
              secondary
              disabled={busy || sheet.p.schedule_state?.status === "paused"}
              onPress={() => {
                setEditing(sheet.key);
                setDate(sheet.missed ? today : sheet.s.date);
              }}
            />}
            {removable(sheet.p, sheet.s) && <Button title="Remove from plan" variant="ghost" disabled={busy}
              onPress={() => { if (current()) { setError(""); setRemoving({ program: sheet.p, session: sheet.s }); } }} />}
            <Button title={inspecting === sheet.key ? "Hide workout details" : "Show workout details"} variant="ghost"
              onPress={() => setInspecting(inspecting === sheet.key ? null : sheet.key)} />
            {inspecting === sheet.key && <PrescriptionPreview workout={sheet.s.workout} />}
          </>}
        </>)}
      </Sheet>
      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.title ?? "Plan"}>
        {!!menu && (
          <>
            <ListRow
              icon="chatbubble-ellipses-outline"
              title="Chat about this plan"
              detail={menu.schedule_state?.archived_at ? "Restore this plan to chat about it" : undefined}
              disabled={!!menu.schedule_state?.archived_at}
              onPress={() => {
                setMenu(null);
                router.push({ pathname: "/coach", params: { program_id: menu.id, revision: String(menu.revision) } });
              }}
            />
            {!menu.schedule_state?.archived_at && menu.schedule_state?.status !== "paused" && <ListRow
              icon="create-outline" title="Rename plan" disabled={busy}
              onPress={() => { if (current()) { setError(""); setRenaming({ program: menu, title: menu.title }); setMenu(null); } }}
            />}
            {!menu.schedule_state?.archived_at && <ListRow
              icon="archive-outline" title="Archive plan" disabled={busy}
              onPress={() => void archive(menu, true)}
            />}
            <ListRow
              icon="share-outline"
              title="Share this plan"
              detail={menu.schedule_state?.archived_at ? "Restore this plan to share it"
                : menu.schedule_state?.status === "paused" ? "Plan your return to share it" : undefined}
              disabled={menu.schedule_state?.status === "paused"}
              onPress={() => {
                setMenu(null);
                router.push({ pathname: "/share", params: { id: menu.id, kind: "program" } });
              }}
            />
            <ListRow icon="add-circle-outline" title="Build a new plan" onPress={() => { setMenu(null); router.push("/build-plan"); }} />
            <ListRow icon="person-outline" title="Edit training profile" detail="Goal, equipment and free days"
              onPress={() => { setMenu(null); router.push("/profile"); }} />
          </>
        )}
      </Sheet>
      <Sheet visible={!!renaming} onClose={() => { if (!busy) setRenaming(null); }} title="Rename plan">
        {renaming && <>
          <Field label="Plan name" value={renaming.title} disabled={busy} onChange={title => { if (current() && !scope.maintaining) setRenaming({ ...renaming, title }); }} />
          {!!error && <Notice error>{error}</Notice>}
          <Button title="Save plan name" busy={busy} onPress={() => void maintain(renaming.program, "rename", renaming.title)} />
          <Button title="Keep original name" secondary disabled={busy} onPress={() => setRenaming(null)} />
        </>}
      </Sheet>
    </Screen>
  );
}

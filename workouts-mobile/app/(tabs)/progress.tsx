import { ActivityWeek } from "@/components/activity-week";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { AccountButton, Button, Card, Copy, Empty, ListGroup, ListRow, Notice, Row, Screen, SectionHeader, Skeleton, useColors } from "@/components/ui";
import { ProgressRecords } from "@/components/progress-records";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { canRecoverResult } from "@/lib/result-recovery";
import { ApiError } from "@/lib/api";
import { isTransientSyncError } from "@/lib/training";
import { exerciseLines, exerciseRecords, friendlyDate } from "@/lib/progress-insights";
import { sessionStatusLabel } from "@/lib/labels";
import type { SessionRequest, Workout } from "@/lib/models";
import { sessionsQuery } from "@/lib/session-query";
import { missingProgressParents, loadProgressAncestry, selectProgressSessions } from "@/lib/progress-selection";
/** The top of a session card: date, title, totals and what was done. Tappable when the session is saved to the account. */
function SessionSummary({ title, when, request, workout, onOpen }: {
  title: string; when: string; request: SessionRequest; workout: Workout; onOpen?: () => void;
}) {
  const c = useColors();
  const { units } = useTraining();
  const sets = request.actuals.filter((a) => a.completed).length, skipped = request.actuals.length - sets;
  const minutes = Math.round((request.active_seconds ?? 0) / 60);
  const lines = exerciseLines(request, workout, units);
  const body = <>
    <Row justify="space-between">
      <Copy kind="caption" tone="muted">{when}</Copy>
      {!!onOpen && <Ionicons name="chevron-forward" size={18} color={c.muted} />}
    </Row>
    <Copy kind="heading">{title}</Copy>
    <Copy kind="small" tone="muted">
      {[`${sets} ${sets === 1 ? "set" : "sets"}`, skipped ? `${skipped} skipped` : null, minutes ? `${minutes} min` : null].filter(Boolean).join(" · ")}
    </Copy>
    {lines.slice(0, 3).map((line, index) => <Copy kind="small" key={index} numberOfLines={1}>{line}</Copy>)}
    {lines.length > 3 && <Copy kind="small" tone="muted">+{lines.length - 3} more</Copy>}
  </>;
  if (!onOpen) return <View style={{ gap: 4 }}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${when}. View session`} onPress={onOpen}
      style={({ pressed }) => ({ gap: 4, opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}
const openSession = (id: string) => router.push({ pathname: "/session/[id]", params: { id } });
export default function Progress() {
  const { api, owner, enrollment, units } = useTraining();
  const cache = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const offline = useOfflineTraining();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const q = useQuery(sessionsQuery(api, owner, enrollment));
  const generation = enrollment?.generation ?? 0;
  const parents = missingProgressParents(offline.state.history, q.data ?? [], generation);
  const needsAncestry = parents.length > 0 && selectProgressSessions(offline.state.history, q.data ?? [], generation).requiresAncestry;
  const ancestry = useQuery({
    queryKey: [owner, "progress-ancestry", generation, parents],
    queryFn: ({ signal }) => loadProgressAncestry(parents, api.session, generation, 64, [
      ...offline.state.history.filter((h) => h.generation === generation).flatMap((h) => h.synced_id ? [h.synced_id] : []),
      ...(q.data?.filter((s) => s.generation === generation).map((s) => s.id) ?? []),
    ], { signal }),
    enabled: !!enrollment?.enrolled && needsAncestry,
  });
  const selected = selectProgressSessions(offline.state.history, q.data ?? [], generation, ancestry.data?.records);
  const { local, remote } = selected;
  const ancestryReady = !needsAncestry || ancestry.data?.complete === true;
  const historyLoading = !!enrollment?.enrolled && (q.isPending || (offline.ready === false && !offline.error));
  const visibleLocal = local.slice(0, visibleCount);
  const visibleRemote = remote.slice(0, Math.max(0, visibleCount - visibleLocal.length));
  useEffect(() => setVisibleCount(20), [owner, generation]);
  // Records and trends only use accepted sessions, and wait for edit history so a corrected result is not double counted.
  const records = ancestryReady ? exerciseRecords(selected.effective, units) : [];
  const weekSessions = selected.effective.map(({ request }) => ({ started_at: request.started_at,
    recorded: request.actuals.some((a) => a.completed), active_seconds: request.active_seconds }));
  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([q.refetch(), cache.invalidateQueries({ queryKey: [owner, "activity-week"] }),
        needsAncestry ? ancestry.refetch() : null]);
    } finally {
      setRefreshing(false);
    }
  }
  async function sync(before?: () => Promise<void>) {
    if (!offline.store) return;
    setBusy(true);
    setError("");
    try {
      await before?.();
      await offline.store.sync(api.saveSession);
      await q.refetch();
    } catch (e) {
      // Connection and server trouble gets a calm retry message; the device store's own guidance is shown as written.
      setError(!(e instanceof Error) || e instanceof TypeError || (e instanceof ApiError && isTransientSyncError(e.status))
        ? "Couldn’t sync right now. Your sessions are safe on this device; try again when you’re online." : e.message);
    } finally {
      setBusy(false);
    }
  }
  function discard(id: string) {
    Alert.alert("Discard this result?", "It is removed from this device only. Nothing saved to your account changes.", [
      { text: "Keep", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => {
        void offline.store?.dismiss(id).catch(() => setError("Couldn’t remove that result. Try again."));
      } },
    ]);
  }
  return (
    <Screen
      title="Progress"
      refreshing={refreshing}
      onRefresh={() => { void refresh(); }}
      action={<AccountButton />}
    >
      {historyLoading ? <Card><Skeleton height={24} width="70%" /><Skeleton height={18} width="50%" /><Copy>Loading your training history…</Copy></Card> : q.error && !q.data ?
        <Card><Copy>Totals will show once your history loads.</Copy></Card> : ancestryReady ? <ActivityWeek sessions={weekSessions} /> : <Card>
        <Copy>{ancestry.isPending ? "Checking your edited sessions…" :
          "Totals are paused so no workout is counted twice."}</Copy>
        {!ancestry.isPending && <Button title="Try again" secondary onPress={() => { void ancestry.refetch(); }} />}
      </Card>}
      <ListGroup>
        <ListRow icon="add-circle-outline" title="Log a completed activity" detail="A run, walk, game or class" onPress={() => router.push("/activity")} />
        <ListRow icon="walk-outline" title="Runs, walks & other activity" onPress={() => router.push("/activity-log")} />
      </ListGroup>
      <ProgressRecords records={records} />
      {!!offline.error && <>
        <Notice error>{offline.error}</Notice>
        <Button title="Retry restoring saved sessions" secondary onPress={offline.retry} />
      </>}
      {!!offline.state.history.filter((h) => h.state === "queued").length && (
        <Button
          title="Sync saved sessions"
          busy={busy}
          onPress={() => {
            void sync();
          }}
        />
      )}
      {q.error && <>
        <Notice error>Your training history couldn’t load. Sessions saved on this device are still shown.</Notice>
        <Button title="Try again" variant="secondary" size="sm" inline icon="refresh" busy={q.isFetching} onPress={() => { void q.refetch(); }} />
      </>}
      {!historyLoading && !q.error && !offline.error && !remote.length && !local.length ? (
        <Empty
          icon="stats-chart-outline"
          title="Your progress starts with a session"
          description="Finished and partly finished workouts show up here."
          action={<Button title="Choose a workout" onPress={() => router.push("/(tabs)/library")} />}
        />
      ) : null}
      {!!(remote.length || local.length) && <SectionHeader title="Recent sessions" />}
      {visibleLocal
        .map((h) => (
          <Card key={h.request.client_session_id}>
            <SessionSummary title={h.workout.title} request={h.request} workout={h.workout}
              when={[friendlyDate(h.request.started_at), sessionStatusLabel(h.request.status),
                h.state === "synced" ? null : h.state === "blocked" ? "Needs review" : "Saved on this device"].filter(Boolean).join(" · ")}
              onOpen={h.synced_id ? () => openSession(h.synced_id!) : undefined} />
            {!!h.problem && <Notice error>{h.problem}</Notice>}
            {!!h.request.supersedes_session_id && <Notice>
              {selected.conflictingQueued.includes(h.request.client_session_id) ?
                "A newer result is already saved, so this edit isn’t used. Retry sync to check again." :
                h.state === "blocked" ? "This edit needs review and isn’t counted yet." :
                h.state === "queued" ? "This edit is saved on this device and will sync soon." :
                  "This edit replaces an earlier result for the same session."}
            </Notice>}
            {h.state === "queued" && (
              <Button
                title="Retry sync"
                secondary
                busy={busy}
                onPress={() => {
                  void sync();
                }}
              />
            )}
            {h.state === "blocked" && (
              <>
                <Notice tone="warning">
                  {h.recovery ? "Your recovery is saved on this device. Continue to finish saving it." :
                    canRecoverResult(h) ? "Recover your recorded result with a private workout copy, or try saving the original again." :
                      "This result is still saved on this device. Try saving again, or discard it here if you no longer need it."}
                </Notice>
                {(canRecoverResult(h) || !!h.recovery) && <Button title={h.recovery ? "Continue result recovery" : "Recover result"}
                  icon="refresh" secondary disabled={busy} onPress={() => router.push({ pathname: "/recover-result/[id]", params: { id: h.request.client_session_id } })} />}
                <Row gap={8} wrap>
                  <Button
                    title="Try saving again"
                    variant="secondary"
                    size="sm"
                    inline
                    icon="refresh"
                    busy={busy}
                    disabled={!!h.recovery}
                    onPress={() => {
                      void sync(() => offline.store!.retry(h.request.client_session_id));
                    }}
                  />
                  <Button
                    title="Discard from this device"
                    variant="destructive"
                    size="sm"
                    inline
                    icon="trash-outline"
                    disabled={busy || !!h.recovery}
                    onPress={() => discard(h.request.client_session_id)}
                  />
                </Row>
              </>
            )}
            {!!h.recovery_origin && <><Notice>This result was recovered with a private workout copy.</Notice>
              <Button title="View original recording" variant="ghost" size="sm" inline onPress={() => router.push({
                pathname: "/recover-result/[id]", params: { id: h.recovery_origin!.request.client_session_id } })} /></>}
            {!!h.request.supersedes_session_id && <Button title="View original saved session" variant="ghost" size="sm" inline
              onPress={() => openSession(h.request.supersedes_session_id!)} />}
          </Card>
        ))}
      {visibleRemote.map((s) => (
        <Card key={s.id}>
          <SessionSummary title={s.title} request={s.content} workout={s.content.prescription_snapshot}
            when={`${friendlyDate(s.started_at)} · ${sessionStatusLabel(s.status)}`} onOpen={() => openSession(s.id)} />
          {!!s.content.supersedes_session_id && <Button title="View previous saved result" variant="ghost" size="sm" inline
            onPress={() => openSession(s.content.supersedes_session_id!)} />}
        </Card>
      ))}
      {local.length + remote.length > visibleCount && <Button title="Show more sessions" secondary
        onPress={() => setVisibleCount((count) => count + 20)} />}
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}

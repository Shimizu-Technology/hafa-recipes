import { ActivityWeek } from "@/components/activity-week";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { AccountButton, Button, Card, Copy, Empty, IconButton, ListGroup, ListRow, Notice, Row, Screen, SectionHeader, Skeleton } from "@/components/ui";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { canRecoverResult } from "@/lib/result-recovery";
import { summaryOf } from "@/lib/training";
import { sessionStatusLabel } from "@/lib/labels";
import { sessionsQuery } from "@/lib/session-query";
import { missingProgressParents, loadProgressAncestry, selectProgressSessions } from "@/lib/progress-selection";
export default function Progress() {
  const { api, owner, enrollment } = useTraining();
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
  async function sync(before?: () => Promise<void>) {
    if (!offline.store) return;
    setBusy(true);
    setError("");
    try {
      await before?.();
      await offline.store.sync(api.saveSession);
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function discard(id: string) {
    Alert.alert("Discard this result?", "It is removed from this device only. Nothing saved to your account changes.", [
      { text: "Keep", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => {
        void offline.store?.dismiss(id).catch((e: Error) => setError(e.message));
      } },
    ]);
  }
  return (
    <Screen
      title="Progress"
      action={
        <Row gap={8}>
          <IconButton icon="add" label="Log completed activity" variant="primary" onPress={() => router.push("/activity")} />
          <AccountButton />
        </Row>
      }
    >
      {historyLoading ? <Card><Skeleton height={24} width="70%" /><Skeleton height={18} width="50%" /><Copy>Loading your training history…</Copy></Card> : q.error && !q.data ?
        <Card><Copy>Totals will show once your history loads.</Copy></Card> : ancestryReady ? <ActivityWeek sessions={selected.sessions} /> : <Card>
        <Copy>{ancestry.isPending ? "Checking your edited sessions…" :
          "Totals are paused so no workout is counted twice."}</Copy>
        {!ancestry.isPending && <Button title="Try again" secondary onPress={() => { void ancestry.refetch(); }} />}
      </Card>}
      <ListGroup>
        <ListRow icon="add-circle-outline" title="Log completed activity" onPress={() => router.push("/activity")} />
        <ListRow icon="walk-outline" title="Runs, walks & other activity history" onPress={() => router.push("/activity-log")} />
      </ListGroup>
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
        <Notice error>{q.error.message} Training saved on this device remains visible below.</Notice>
        <Button title="Retry loading training history" secondary busy={q.isFetching} onPress={() => { void q.refetch(); }} />
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
            <Copy kind="caption" tone="muted">
              {new Date(h.request.started_at).toLocaleDateString()} · {sessionStatusLabel(h.request.status)} ·{" "}
              {h.state === "synced" ? "Synced" : h.state === "blocked" ? "Needs review" : "Saved on device"}
            </Copy>
            <Copy kind="heading">{h.workout.title}</Copy>
            <Copy kind="numericSmall">
              {h.request.actuals.filter((a) => a.completed).length} completed sets ·{" "}
              {h.request.actuals.filter((a) => !a.completed).length} skipped
            </Copy>
            {h.request.actuals
              .filter((a) => a.completed)
              .map((a, index) => (
                <Copy kind="small" tone="muted" key={index}>
                  {h.workout.blocks.find((b) => b.id === a.block_id)?.exercises[a.exercise_index]?.name} ·{" "}
                  {summaryOf(a)}
                </Copy>
              ))}
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
            {!!h.synced_id && (
              <Button
                title="View saved session"
                variant="ghost"
                size="sm"
                inline
                icon="chevron-forward"
                onPress={() => router.push({ pathname: "/session/[id]", params: { id: h.synced_id! } })}
              />
            )}
            {!!h.request.supersedes_session_id && <Button title="View original saved session" variant="ghost" size="sm" inline
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: h.request.supersedes_session_id! } })} />}
          </Card>
        ))}
      {visibleRemote.map((s) => (
        <Card key={s.id}>
          <Copy kind="caption" tone="muted">
            {new Date(s.started_at).toLocaleDateString()} · {sessionStatusLabel(s.status)}
          </Copy>
          <Copy kind="heading">{s.title}</Copy>
          <Copy kind="numericSmall">{s.content.actuals.filter((a) => a.completed).length} completed sets</Copy>
          <Button
            title="View saved session"
            variant="ghost"
            size="sm"
            inline
            icon="chevron-forward"
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: s.id } })}
          />
          {!!s.content.supersedes_session_id && <Button title="View previous saved result" variant="ghost" size="sm" inline
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: s.content.supersedes_session_id! } })} />}
        </Card>
      ))}
      {local.length + remote.length > visibleCount && <Button title="Show more sessions" secondary
        onPress={() => setVisibleCount((count) => count + 20)} />}
      <Button
        title="Refresh training history"
        variant="ghost"
        icon="refresh"
        busy={busy || q.isFetching}
        onPress={() => {
          void q.refetch();
        }}
      />
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}

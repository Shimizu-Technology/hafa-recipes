import { ActivityWeek } from "@/components/activity-week";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { router } from "expo-router";
import { AccountButton, Button, Card, Copy, Empty, Notice, Screen, useColors } from "@/components/ui";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { summaryOf } from "@/lib/training";
import { missingProgressParents, loadProgressAncestry, selectProgressSessions } from "@/lib/progress-selection";
export default function Progress() {
  const { api, owner, enrollment } = useTraining();
  const offline = useOfflineTraining();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const q = useQuery({
    queryKey: [owner, "sessions", enrollment?.generation],
    queryFn: api.sessions,
    enabled: !!enrollment?.enrolled,
  });
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
  async function sync() {
    if (!offline.store) return;
    setBusy(true);
    setError("");
    try {
      await offline.store.sync(api.saveSession);
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen title="See your work add up." subtitle="Recorded sessions, at your own pace." action={<AccountButton />}>
      <Button title="Log completed activity" icon="add" onPress={() => router.push("/activity")} />
      <Button title="Runs, walks & other activity history" secondary onPress={() => router.push("/activity-log")} />
      {ancestryReady ? <ActivityWeek sessions={selected.sessions} /> : <Card>
        <Copy>{ancestry.isPending ? "Checking session corrections before counting your progress…" :
          "Correction history could not be fully verified. Session totals stay paused to avoid counting one workout twice. Your saved results remain below."}</Copy>
        {!ancestry.isPending && <Button title="Retry correction history" secondary onPress={() => { void ancestry.refetch(); }} />}
      </Card>}
      {!!offline.error && <Notice error>{offline.error}</Notice>}
      {!!offline.state.history.filter((h) => h.state === "queued").length && (
        <Button
          title="Sync saved sessions"
          busy={busy}
          onPress={() => {
            void sync();
          }}
        />
      )}
      {q.error && <Notice error>{q.error.message} Training saved on this device remains visible below.</Notice>}
      {!remote.length && !local.length ? (
        <Empty
          icon="stats-chart-outline"
          title="Your progress starts with a session"
          description="Actual completed and partial sessions appear here. A plan or elapsed time alone never counts as completed training."
          action={<Button title="Choose a workout" onPress={() => router.push("/(tabs)/library")} />}
        />
      ) : null}
      {local
        .map((h) => (
          <Card key={h.request.client_session_id}>
            <Copy kind="small" color={c.muted}>
              {new Date(h.request.started_at).toLocaleDateString()} · {h.request.status} ·{" "}
              {h.state === "synced" ? "Synced" : h.state === "blocked" ? "Needs review" : "Saved on device"}
            </Copy>
            <Copy kind="heading">{h.workout.title}</Copy>
            <Copy>
              {h.request.actuals.filter((a) => a.completed).length} completed sets ·{" "}
              {h.request.actuals.filter((a) => !a.completed).length} skipped
            </Copy>
            {h.request.actuals
              .filter((a) => a.completed)
              .map((a, index) => (
                <Copy kind="small" key={index}>
                  {h.workout.blocks.find((b) => b.id === a.block_id)?.exercises[a.exercise_index]?.name} ·{" "}
                  {summaryOf(a)}
                </Copy>
              ))}
            {!!h.problem && <Notice error>{h.problem}</Notice>}
            {!!h.request.supersedes_session_id && <Notice>
              {selected.conflictingQueued.includes(h.request.client_session_id) ?
                "A newer saved result already exists. This device correction stays available for conflict review and does not replace the saved actuals. Retry sync to confirm its status." :
                h.state === "blocked" ? "This correction needs review and does not replace the saved actuals in your progress count." :
                h.state === "queued" ? "This is a correction to the same workout session, saved on this device while sync finishes." :
                  "This saved correction replaces an earlier result for the same workout session."}
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
              <Notice>
                This result keeps its original account generation and session identity. Review the conflict with
                support; it is never silently rewritten into a new account.
              </Notice>
            )}
            {!!h.synced_id && (
              <Button
                title="View saved session"
                secondary
                onPress={() => router.push({ pathname: "/session/[id]", params: { id: h.synced_id! } })}
              />
            )}
            {!!h.request.supersedes_session_id && <Button title="View original saved session" secondary
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: h.request.supersedes_session_id! } })} />}
          </Card>
        ))}
      {remote.map((s) => (
        <Card key={s.id}>
          <Copy kind="small" color={c.muted}>
            {new Date(s.started_at).toLocaleDateString()} · {s.status}
          </Copy>
          <Copy kind="heading">{s.title}</Copy>
          <Copy>{s.content.actuals.filter((a) => a.completed).length} completed sets</Copy>
          <Button
            title="View saved session"
            secondary
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: s.id } })}
          />
          {!!s.content.supersedes_session_id && <Button title="View previous saved result" secondary
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: s.content.supersedes_session_id! } })} />}
        </Card>
      ))}
      <Button
        title="Refresh training history"
        secondary
        busy={busy}
        onPress={() => {
          void q.refetch();
        }}
      />
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}

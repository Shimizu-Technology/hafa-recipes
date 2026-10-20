import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Copy, Field, ListGroup, ListRow, Notice, Row, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { CoachActionPreview } from "@/components/coach-action-preview";
import { CoachChangeRows, useCoachSuggestion } from "@/components/coach-suggestion";
import { useTraining } from "@/lib/context";
import type { CoachSummary } from "@/lib/coach";

/** Full details of one coach suggestion, with the same one-tap Apply and Undo as the chat card. */
export default function CoachActionReview() {
  const params = useLocalSearchParams<{ id: string; generation?: string; state?: string }>();
  const { api, owner, enrollment } = useTraining();
  const generation = Number(params.generation ?? enrollment?.generation ?? 0);
  const current = enrollment?.enrolled && enrollment.generation === generation;
  const history = useQuery({
    queryKey: [owner, "coach-action-history", generation],
    queryFn: () => api.coachHistory(),
    enabled: !!current,
  });
  const known = history.data?.messages.flatMap((message) => message.actions).find((action) => action.proposal_id === params.id);
  const s = useCoachSuggestion(params.id, generation, known?.state ?? (params.state as CoachSummary["state"] | undefined) ?? "proposed");
  const data = s.action.data;
  const [title, setTitle] = useState<string | null>(null);
  const planName = title ?? data?.proposal.program?.title ?? "Training plan";
  const [result, setResult] = useState("");
  const footer = !data ? undefined : s.state === "proposed" ? (s.ready ? (
    <Button title="Apply" icon="checkmark" busy={s.busy} disabled={!planName.trim()}
      onPress={() => { void s.apply({ title: planName, shownPrescriptions: true }).then(done => { if (done) setResult("Applied. Your completed training stays as it is."); }); }} />
  ) : undefined) : s.state === "accepted" ? (
    <Row justify="space-between">
      <Copy kind="label" style={{ flexShrink: 1 }}>{result || "Applied"}</Copy>
      <Button title="Undo" icon="arrow-undo-outline" secondary size="sm" inline busy={s.busy}
        onPress={() => { void s.undo().then(done => { if (done) setResult("Undone."); }); }} />
    </Row>
  ) : <Copy kind="label">{result || "Undone. This suggestion stays here for your records."}</Copy>;
  // After applying, "before" is re-read from the changed record, so only show what the suggestion sets.
  const rows = s.summary && (s.state === "proposed" ? s.summary : { ...s.summary, rows: s.summary.rows.map(({ label, after }) => ({ label, after })) });
  return (
    <Screen
      back
      title={s.summary?.title ?? "Suggested change"}
      subtitle={s.state === "proposed" ? "Nothing changes until you apply it." : undefined}
      footer={footer}
    >
      {!current && (
        <Notice error>This suggestion belongs to an older Workouts account setup and can’t be applied now.</Notice>
      )}
      <QueryState loading={s.action.isPending && !!current} error={s.action.error} retry={() => { void s.action.refetch(); }}>
        {data && <>
          {rows && <Card><CoachChangeRows summary={rows} /></Card>}
          {s.state === "proposed" && data.proposal.status !== "ready" && <Button title="Answer in Coach" secondary inline
            onPress={() => router.canGoBack() ? router.back() : router.push("/coach")} />}
          {s.state === "proposed" && data.kind === "program" && <Field label="Plan name" value={planName} disabled={s.busy} onChange={setTitle} />}
          {s.state === "proposed" && s.needsFullReview && <>
            <Copy kind="small" tone="muted">
              Applying confirms the sets and reps below still feel comfortable for you now. It isn’t medical clearance.
            </Copy>
            <ListRow icon="person-outline" title="Check your starting point in your profile" onPress={() => router.push("/profile")} />
          </>}
          {s.state === "proposed" && !s.ready && data.proposal.status === "ready" && <Notice>This suggestion expired. Ask Coach again for a fresh one.</Notice>}
          {s.state === "accepted" && <Copy kind="small" tone="muted">
            You can undo this while the change is unused. Undo can’t change completed training or later edits.
          </Copy>}
          <CoachActionPreview action={data} />
        </>}
      </QueryState>
      {!!s.error && <>
        <Notice error>{s.error}</Notice>
        <Button title="Ask Coach again" secondary inline onPress={() => router.push("/coach")} />
      </>}
      <ListGroup>
        <ListRow icon="calendar-outline" title="Open training plans" onPress={() => router.push("/(tabs)/plan")} />
        <ListRow icon="albums-outline" title="Open your library" onPress={() => router.push("/(tabs)/library")} />
      </ListGroup>
    </Screen>
  );
}

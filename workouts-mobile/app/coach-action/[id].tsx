import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { CoachActionPreview } from "@/components/coach-action-preview";
import { useTraining } from "@/lib/context";
import { canAcceptCoach, needsReturnConfirmation } from "@/lib/coach";
export default function CoachActionReview() {
  const params = useLocalSearchParams<{ id: string; generation?: string; state?: string }>();
  const { api, owner, enrollment } = useTraining();
  const generation = Number(params.generation ?? enrollment?.generation ?? 0);
  const current = enrollment?.enrolled && enrollment.generation === generation;
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "coach-action", params.id, generation],
    queryFn: () => api.coachAction(params.id),
    enabled: !!current,
  });
  const history = useQuery({
    queryKey: [owner, "coach-action-history", generation],
    queryFn: () => api.coachHistory(),
    enabled: !!current,
  });
  const summary = history.data?.messages
    .flatMap((message) => message.actions)
    .find((action) => action.proposal_id === params.id);
  const [state, setState] = useState(params.state ?? "proposed");
  const effective = state;
  useEffect(() => {
    if (summary) setState(summary.state);
  }, [history.dataUpdatedAt, summary?.state]);
  const [reviewed, setReviewed] = useState(false);
  const [baseline, setBaseline] = useState(false);
  const [title, setTitle] = useState("Training plan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [undoConfirm, setUndoConfirm] = useState(false);
  async function refreshAffected() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: [owner, "programs"] }),
      cache.invalidateQueries({ queryKey: [owner, "program"] }),
      cache.invalidateQueries({ queryKey: [owner, "profile"] }),
      cache.invalidateQueries({ queryKey: [owner, "library"] }),
      cache.invalidateQueries({ queryKey: [owner, "coach-history"] }),
      history.refetch(),
    ]);
  }
  async function accept() {
    if (!q.data || !canAcceptCoach(q.data, reviewed, baseline) || !current) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.acceptCoachAction(
        params.id,
        title,
        needsReturnConfirmation(q.data) && baseline,
        generation
      );
      setState(saved.state);
      setResult("The reviewed change was applied. Completed training remains unchanged.");
      await refreshAffected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      await api.undoCoachAction(params.id, generation);
      setState("undone");
      setUndoConfirm(false);
      setResult("This unused future change was undone. Historical training remains unchanged.");
      await refreshAffected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      title="Review before changing anything."
      subtitle="A suggestion becomes a change only when you accept it."
    >
      {!current && (
        <Notice error>
          This suggestion belongs to an older Workouts enrollment. It has not been accepted under new account data.
        </Notice>
      )}
      <QueryState
        loading={q.isPending && !!current}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {q.data && (
          <>
            <CoachActionPreview action={q.data} />
            {effective === "proposed" ? (
              <>
                <Field
                  label="Name for a created plan or workout"
                  value={title}
                  onChange={(value) => {
                    if (!busy) setTitle(value);
                  }}
                />
                <Choice
                  label="I reviewed the proposed prescriptions, preferences, dates and warnings"
                  selected={reviewed}
                  disabled={busy}
                  onPress={() => setReviewed(!reviewed)}
                />
                {needsReturnConfirmation(q.data) && (
                  <Card>
                    <Notice>
                      Returning from a pause requires a fresh readiness check after the pause and an updated comfortable
                      baseline in your profile. Stored paused sessions remain dormant until this reviewed return is
                      accepted.
                    </Notice>
                    <Button
                      title="Review my baseline in profile"
                      secondary
                      disabled={busy}
                      onPress={() => router.push("/profile")}
                    />
                    <Choice
                      label="These shown prescriptions match my current comfortable baseline"
                      detail="This is an explicit return confirmation, not a medical clearance."
                      selected={baseline}
                      disabled={busy}
                      onPress={() => setBaseline(!baseline)}
                    />
                  </Card>
                )}
                <Button
                  title="Accept this reviewed change"
                  busy={busy}
                  disabled={!current || !title.trim() || !canAcceptCoach(q.data, reviewed, baseline)}
                  onPress={() => {
                    void accept();
                  }}
                />
                {q.data.proposal.status !== "ready" && (
                  <Button title="Update profile or ask a follow-up" secondary onPress={() => router.push("/coach")} />
                )}
              </>
            ) : (
              <Notice>
                {effective === "accepted"
                  ? "This change was accepted. An unused future change can be undone if its source and recorded history still permit it."
                  : "This change was undone; its suggestion remains visible for your records."}
              </Notice>
            )}
            {effective === "accepted" && (
              <Button
                title="Review undoing this future change"
                secondary
                disabled={busy}
                onPress={() => setUndoConfirm(true)}
              />
            )}
          </>
        )}
      </QueryState>
      {undoConfirm && (
        <Card>
          <Notice>
            Undo can remove an unchanged unused created copy/plan or revert an unchanged future edit. It cannot rewrite
            completed training or erase later changes. The service will recheck the current record and history.
          </Notice>
          <Button
            title="Undo this unused future change"
            secondary
            busy={busy}
            onPress={() => {
              void undo();
            }}
          />
          <Button title="Keep the accepted change" secondary disabled={busy} onPress={() => setUndoConfirm(false)} />
        </Card>
      )}
      {!!result && <Notice>{result}</Notice>}
      {!!error && (
        <>
          <Notice error>{error}</Notice>
          <Button title="Ask for a fresh review with current context" secondary onPress={() => router.push("/coach")} />
        </>
      )}
      <Button title="Open training plans" secondary onPress={() => router.push("/(tabs)/plan")} />
      <Button title="Open private library" secondary onPress={() => router.push("/(tabs)/library")} />
    </Screen>
  );
}

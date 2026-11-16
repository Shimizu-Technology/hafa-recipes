import { useState } from "react";
import { Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Copy, Notice, Screen, useToast } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";

/**
 * Heart-rate summaries: off unless the person turns them on. Only an average and maximum per workout (and per
 * part) are saved, never a heart-rate trace. Turning off can keep or delete what was saved.
 */
export default function HeartRateSummaries() {
  const { api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const toast = useToast();
  const key = [owner, "heart-rate-summaries", enrollment?.generation];
  const q = useQuery({ queryKey: key, enabled: !!enrollment?.enrolled, queryFn: () => api.heartRateSummaries() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(work: () => Promise<{ enabled: boolean; deleted_sessions?: number }>, done: (r: { deleted_sessions?: number }) => string) {
    setBusy(true); setError("");
    try {
      const result = await work();
      cache.setQueryData(key, { available: q.data?.available ?? true, enabled: result.enabled });
      void cache.invalidateQueries({ queryKey: [owner, "sessions"] });
      toast(done(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const confirmDelete = () => Alert.alert("Turn off and delete saved heart-rate summaries?",
    "Every saved heart-rate average and maximum is removed from your Workouts history, including edited sessions. Your workouts and scores stay. Apple Health keeps its own data.",
    [{ text: "Cancel", style: "cancel" }, { text: "Turn off and delete", style: "destructive",
      onPress: () => { void change(() => api.deleteHeartRateSummaries(),
        (r) => `Turned off. Deleted from ${r.deleted_sessions ?? 0} ${r.deleted_sessions === 1 ? "session" : "sessions"}.`); } }]);
  return (
    <Screen native back title="Heart-rate summaries">
      <QueryState hasData={q.data !== undefined} loading={q.isPending && !!enrollment?.enrolled} error={q.error} retry={() => { void q.refetch(); }}>
        <Copy>
          When this is on, a workout recorded with your Apple Watch or Apple Health can save its average and maximum heart
          rate with your scores, so you can compare classes over time.
        </Copy>
        <Copy tone="muted">
          Only those two numbers are saved, per workout and per part, never your full heart-rate data. They stay private
          to your account and are never used for ads. It’s off unless you turn it on.
        </Copy>
        {q.data && !q.data.available && <Notice>Heart-rate summaries aren’t available yet. Check back after the next update.</Notice>}
        {!!error && <Notice error>{error}</Notice>}
        {q.data?.available && !q.data.enabled && <Button title="Turn on heart-rate summaries" icon="heart-outline" busy={busy}
          onPress={() => { void change(() => api.setHeartRateSummaries(true), () => "Heart-rate summaries are on."); }} />}
        {q.data?.enabled && <>
          <Notice tone="success">On. New workouts can save heart-rate summaries.</Notice>
          <Button title="Turn off, keep saved summaries" variant="secondary" busy={busy}
            onPress={() => { void change(() => api.setHeartRateSummaries(false), () => "Turned off. Saved summaries are kept."); }} />
        </>}
        {q.data && <Button title="Turn off and delete saved heart-rate summaries" variant="destructive" icon="trash-outline" disabled={busy}
          onPress={confirmDelete} />}
      </QueryState>
    </Screen>
  );
}

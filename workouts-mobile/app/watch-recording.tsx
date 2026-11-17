import { router, useLocalSearchParams } from "expo-router";
import { Screen, Card, Copy, Notice, Button } from "@/components/ui";
import { SessionTable } from "@/components/session-table";
import { useOfflineTraining, useTraining } from "@/lib/context";
import { formatPartScore } from "@/lib/class-session";
import { partTitle } from "@/lib/class-view";
/** Local results are reviewable even before they have a server session ID. */
export default function WatchRecording() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useOfflineTraining();
  const { units } = useTraining();
  const item = state.history.find(h => h.request.client_session_id === id);
  const scores = item?.request.results ?? [];
  return <Screen back title={item?.workout.title ?? "Recording"}>
    {item ? <>
      <Copy kind="label">Recorded on {item.request.recorded_on === "watch" ? "watch" : "phone"}</Copy>
      <Copy kind="small">{new Date(item.request.started_at).toLocaleString()} · {Math.round((item.request.active_seconds ?? 0) / 60)} min</Copy>
      <Notice>This result is saved on this phone. {item.state === "queued" ? "It will upload when connected." : item.problem ?? "Open history to manage it."}</Notice>
      {!!scores.length && <Card compact>
        <Copy kind="label">Scores</Copy>
        {scores.map(r => { const block = item.workout.blocks.find(b => b.id === r.block_id);
          return <Copy key={r.block_id}>{[block ? partTitle(block) : r.block_id, formatPartScore(r)].filter(Boolean).join(" · ")}</Copy>; })}
      </Card>}
      <SessionTable actuals={item.request.actuals} workout={item.workout} units={units} />
      <Button title="Open history" variant="secondary" onPress={() => router.push("/history-progress")} />
    </> : <Notice>This recording is no longer on this phone. Check your saved history.</Notice>}
  </Screen>;
}

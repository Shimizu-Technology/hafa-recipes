import { WatchSessionSummary } from "@/components/watch-session-summary";
import { router, useLocalSearchParams } from "expo-router";
import { Screen, Copy, Notice, Button } from "@/components/ui";
import { SessionTable } from "@/components/session-table";
import { useOfflineTraining, useTraining } from "@/lib/context";
/** Local results are reviewable even before they have a server session ID. */
export default function WatchRecording() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useOfflineTraining();
  const { units } = useTraining();
  const item = state.history.find(h => h.request.client_session_id === id);
  return <Screen back title={item?.workout.title ?? "Recording"}>
    {item ? <>
      <Copy kind="label">Recorded on {item.request.recorded_on === "watch" ? "watch" : "phone"}</Copy>
      <Copy kind="small">{new Date(item.request.started_at).toLocaleString()} · {Math.round((item.request.active_seconds ?? 0) / 60)} min</Copy>
      <Notice>This result is saved on this phone. {item.state === "queued" ? "It will upload when connected." : item.problem ?? "Open history to manage it."}</Notice>
      <WatchSessionSummary details={item.watch} workout={item.workout} segments={item.request.segments} />
      <SessionTable actuals={item.request.actuals} workout={item.workout} units={units} />
      <Button title="Open history" variant="secondary" onPress={() => router.push("/history-progress")} />
    </> : <Notice>This recording is no longer on this phone. Check your saved history.</Notice>}
  </Screen>;
}

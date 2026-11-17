import { router } from "expo-router";
import { Button, ButtonRow, Notice, Card } from "./ui";
import type { SavedLocalSession, TrainingState } from "@/lib/training";
import { watchCollisions } from "@/lib/watch-sync";
export function WatchCollisions({ state, today, timezone }: { state: TrainingState; today: string; timezone: string }) {
  function open(item: SavedLocalSession) {
    router.push(item.synced_id ? { pathname: "/session/[id]", params: { id: item.synced_id } } :
      { pathname: "/watch-recording", params: { id: item.request.client_session_id } });
  }
  return <>{watchCollisions(state, today, timezone).map(watch => <Card key={watch.request.client_session_id}>
    <Notice>Recorded on watch and phone. Keep one.</Notice>
    <ButtonRow><Button title="View watch" variant="secondary" onPress={() => open(watch)} />
      <Button title="View phone" variant="secondary" onPress={() => {
        const phone = state.history.find(p => p.request.client_session_id === watch.watch?.duplicate_phone_id);
        if (phone) open(phone); else router.push("/training");
      }} /></ButtonRow>
  </Card>)}</>;
}

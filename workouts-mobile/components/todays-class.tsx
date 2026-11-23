import { WatchAttentionRow } from "./watch-attention";
import { WatchCollisions } from "./watch-collision";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ListGroup, ListRow, Notice, Button } from "./ui";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { dateInTimezone, trainingTimezone } from "@/lib/training";

/** Saved class records use the shared workout model; the runner owns execution. */
export function TodaysClass() {
  const { api, owner, enrollment } = useTraining();
  const offline = useOfflineTraining();
  const enabled = !!enrollment?.enrolled;
  const library = useQuery({ queryKey: [owner, "library", "search", enrollment?.generation], queryFn: api.library, enabled });
  const profile = useQuery({ queryKey: [owner, "profile", enrollment?.generation], queryFn: api.profile, enabled });
  useFocusRefresh([library, profile], { enabled });
  // No saved profile yet: the phone's timezone sets the training day. Only a failed request is an error.
  const timezone = profile.isSuccess ? trainingTimezone(profile.data) : null;
  const today = timezone ? dateInTimezone(new Date(), timezone) : null;
  const tomorrow = today ? nextDate(today) : null;
  const gym = (date: string | null) => library.data?.filter(w => date !== null && w.programming?.source_kind === "gym" && w.programming.date === date) ?? [];
  const classes = gym(today);
  const upcoming = gym(tomorrow);
  return <ListGroup>
    {today && timezone && <WatchCollisions state={offline.state} today={today} timezone={timezone} />}
    {offline.watchSync && <WatchAttentionRow items={offline.watchSync.attention} discard={offline.watchSync.discard} />}
    {profile.error && <><Notice error>Could not load your training timezone. Retry before choosing today’s class.</Notice><Button title="Retry timezone" secondary onPress={() => { void profile.refetch(); }} /></>}
    {library.error && <><Notice error>Could not load today’s classes.</Notice><Button title="Retry classes" secondary onPress={() => { void library.refetch(); }} /></>}
    {classes.map(w => <ListRow key={w.id} icon="barbell-outline" title={w.title} detail="Today’s class · Ready to train"
      onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })} />)}
    {upcoming.map(w => <ListRow key={w.id} icon="calendar-outline" title={w.title} detail="Tomorrow’s class · Saved and ready"
      onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })} />)}
    <ListRow icon="today-outline" title="Today’s class" detail="Import gym text, screenshots or a Full Page PDF"
      onPress={() => router.push("/extract?class=1")} />
  </ListGroup>;
}

/** The calendar day after a YYYY-MM-DD date. */
function nextDate(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

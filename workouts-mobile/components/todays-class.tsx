import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ListGroup, ListRow, Notice, Button } from "./ui";
import { useTraining } from "@/lib/context";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { dateInTimezone } from "@/lib/training";

/** Saved class records use the shared workout model; the runner owns execution. */
export function TodaysClass() {
  const { api, owner, enrollment } = useTraining();
  const enabled = !!enrollment?.enrolled;
  const library = useQuery({ queryKey: [owner, "library", "search", enrollment?.generation], queryFn: api.library, enabled });
  const profile = useQuery({ queryKey: [owner, "profile", enrollment?.generation], queryFn: api.profile, enabled });
  useFocusRefresh([library, profile], { enabled });
  const today = profile.data ? dateInTimezone(new Date(), profile.data.timezone) : null;
  const classes = library.data?.filter(w => w.programming?.source_kind === "gym" && w.programming.date === today) ?? [];
  return <ListGroup>
    {(profile.error || profile.data === null) && <><Notice error>Could not load your training timezone. Retry before choosing today’s class.</Notice><Button title="Retry timezone" secondary onPress={() => { void profile.refetch(); }} /></>}
    {library.error && <><Notice error>Could not load today’s classes.</Notice><Button title="Retry classes" secondary onPress={() => { void library.refetch(); }} /></>}
    {classes.map(w => <ListRow key={w.id} icon="barbell-outline" title={w.title} detail="Today’s class · Ready to train"
      onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })} />)}
    <ListRow icon="today-outline" title="Today’s class" detail="Import gym text, screenshots or a Full Page PDF"
      onPress={() => router.push("/extract?class=1")} />
  </ListGroup>;
}

import type { SearchBarCommands } from "react-native-screens";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Empty, Field, ListGroup, ListRow, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { filterLibrary } from "@/lib/library";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

export default function Search() {
  const { api, owner, enrollment } = useTraining();
  const searchBar = useRef<SearchBarCommands | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => { setQuery(""); searchBar.current?.clearText(); }, [owner, enrollment?.generation]);
  const library = useQuery({ queryKey: [owner, "library", "search", enrollment?.generation], queryFn: api.library, enabled: !!enrollment?.enrolled });
  const fresh = useFocusRefresh([library], { enabled: !!enrollment?.enrolled });
  const [settled, setSettled] = useState("");
  useEffect(() => { const timer = setTimeout(() => setSettled(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const caps = useQuery({ queryKey: [owner, "capabilities", enrollment?.generation], queryFn: api.capabilities });
  const discover = useQuery({ queryKey: [owner, "discover", "search", enrollment?.generation, settled], queryFn: ({ signal }) => api.discover({ q: settled }, 0, signal), enabled: !!settled && caps.data?.discover === true });
  const results = filterLibrary(library.data ?? [], query, null, null);
  const placeholder = `Search ${library.data?.length ?? "your"} workouts`;
  return <>
    <Stack.Screen options={{ headerSearchBarOptions: Platform.OS === "ios" ? { ref: searchBar, placeholder, autoFocus: true, hideWhenScrolling: false,
      onChangeText: event => setQuery(event.nativeEvent.text), onCancelButtonPress: () => setQuery("") } : undefined }} />
    <Screen title="Search" refreshing={fresh.refreshing} onRefresh={fresh.onRefresh}>
      {Platform.OS !== "ios" && <Field label="Search your library" hideLabel value={query} onChange={setQuery} placeholder={placeholder} />}
      {!!library.error && <Notice error>{library.error.message}</Notice>}
      {!enrollment?.enrolled ? <ListRow title="Set up your library" onPress={() => router.push("/onboarding")} /> :
        library.isPending ? <Copy tone="muted">Loading your library…</Copy> :
        !query.trim() ? <><Copy kind="heading">Try searching</Copy><ListGroup>{["Dumbbells", "Bodyweight", "Full body", "Squat"].map(term => <ListRow key={term} icon="search-outline" title={term} onPress={() => { setQuery(term); searchBar.current?.setText(term); }} />)}</ListGroup></> :
        results.length ? <><Copy kind="heading">My workouts</Copy><ListGroup>{results.map(workout =>
          <ListRow key={workout.id} title={workout.title} detail={[workout.estimated_minutes ? `${workout.estimated_minutes} min` : null, workout.equipment_required?.join(", ")].filter(Boolean).join(" · ")}
            onPress={() => router.push({ pathname: "/workout/[id]", params: { id: workout.id } })} />)}</ListGroup></> :
        <Empty icon="search" title={query.trim() ? "No matching workouts" : "Your library is empty"} description={query.trim() ? "Try a title, exercise or piece of equipment." : "Add a workout from Today or Library."} />}
      {!!query.trim() && caps.data?.discover && <>
        <Copy kind="heading">Discover</Copy>
        {discover.isPending ? <Copy tone="muted">Searching Discover…</Copy> : discover.error ? <ListRow title={`Search Discover for '${query.trim()}'`} onPress={() => router.push({ pathname: "/(tabs)/discover", params: { q: query.trim() } })} /> :
          discover.data?.items.length ? <ListGroup>{discover.data.items.map(card => <ListRow key={card.id} title={card.title} detail={card.source_creator ?? card.contributor.display_name} onPress={() => router.push({ pathname: "/discover/[id]", params: { id: card.id } })} />)}</ListGroup> : <Copy tone="muted">No matching shared workouts.</Copy>}
      </>}
    </Screen>
  </>;
}

import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Empty, Field, ListGroup, ListRow, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { filterLibrary } from "@/lib/library";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

export default function Search() {
  const { api, owner, enrollment } = useTraining();
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [owner, enrollment?.generation]);
  const library = useQuery({ queryKey: [owner, "search-library", enrollment?.generation], queryFn: api.library, enabled: !!enrollment?.enrolled });
  const fresh = useFocusRefresh([library], { enabled: !!enrollment?.enrolled });
  const results = filterLibrary(library.data ?? [], query, null, null);
  const placeholder = `Search ${library.data?.length ?? "your"} workouts`;
  return <>
    <Stack.Screen options={{ headerSearchBarOptions: Platform.OS === "ios" ? { placeholder, autoFocus: true, hideWhenScrolling: false,
      onChangeText: event => setQuery(event.nativeEvent.text), onCancelButtonPress: () => setQuery("") } : undefined }} />
    <Screen title="Search" refreshing={fresh.refreshing} onRefresh={fresh.onRefresh}>
      {Platform.OS !== "ios" && <Field label="Search your library" hideLabel value={query} onChange={setQuery} placeholder={placeholder} />}
      {!!library.error && <Notice error>{library.error.message}</Notice>}
      {!enrollment?.enrolled ? <ListRow title="Set up your library" onPress={() => router.push("/onboarding")} /> :
        library.isPending ? <Copy tone="muted">Loading your library…</Copy> :
        results.length ? <><Copy kind="heading">My workouts</Copy><ListGroup>{results.map(workout =>
          <ListRow key={workout.id} title={workout.title} detail={[workout.estimated_minutes ? `${workout.estimated_minutes} min` : null, workout.equipment_required?.join(", ")].filter(Boolean).join(" · ")}
            onPress={() => router.push({ pathname: "/workout/[id]", params: { id: workout.id } })} />)}</ListGroup></> :
        <Empty icon="search" title={query.trim() ? "No matching workouts" : "Your library is empty"} description={query.trim() ? "Try a title, exercise or piece of equipment." : "Add a workout from Today or Library."} />}
    </Screen>
  </>;
}

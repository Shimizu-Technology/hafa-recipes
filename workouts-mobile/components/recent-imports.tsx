import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { ListGroup, ListRow, SectionHeader } from "./ui";
import { useTraining } from "@/lib/context";
import { recentImports } from "@/lib/add-composer";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

/** Saved imports on the Add tab. Hidden until there is something to open. */
export function RecentImports() {
  const { api, owner, enrollment } = useTraining();
  const generation = enrollment?.generation;
  const enabled = !!enrollment?.enrolled;
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const capabilities = useQuery({ queryKey: [owner, "capabilities", generation], queryFn: api.capabilities, enabled, staleTime: 60000 });
  // Shares ImportList's cache entry; ImportList owns polling while jobs run.
  const jobs = useQuery({ queryKey: [owner, "imports", generation], queryFn: () => api.importJobs(),
    enabled: enabled && focused && capabilities.data?.server_auto_save === true, staleTime: 30000 });
  // Library search is newest first, so its first page holds the latest imports.
  const library = useQuery({ queryKey: [owner, "library", generation, "recent-imports"],
    queryFn: () => api.searchLibrary({}, null, generation ?? 0), enabled });
  useFocusRefresh([library], { enabled });
  const items = recentImports(jobs.data, library.data?.items, generation);
  if (!items.length) return null;
  return (
    <>
      <SectionHeader title="Recent imports" action={{ label: "Library", onPress: () => router.navigate("/(tabs)/library") }} />
      <ListGroup>
        {items.map(item => (
          <ListRow key={item.id} title={item.title} detail={item.detail || undefined} icon="barbell-outline"
            onPress={() => router.push({ pathname: "/workout/[id]", params: { id: item.id } })} />
        ))}
      </ListGroup>
    </>
  );
}

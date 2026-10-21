import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Storage } from "./drafts";
import { draftKey } from "./drafts";
import { workoutKindLabel, workoutOrigin } from "./labels";
import type { Workout } from "./models";

export type LibraryView = "grid" | "list";

/**
 * Remember grid or list per account on this device, shared by the Library and
 * collection screens. Starts as a grid; a choice made before the saved value
 * loads wins over it.
 */
export function useLibraryView(storage: Storage & { isCurrent(): boolean }, owner: string) {
  const cache = useQueryClient();
  const key = [owner, "library-view"];
  const saved = useQuery({
    queryKey: key,
    queryFn: async (): Promise<LibraryView> => {
      const value = await storage.getItem(draftKey(owner, "library-view")).catch(() => null);
      return cache.getQueryData<LibraryView>(key) ?? (value === "list" ? "list" : "grid");
    },
    enabled: !!owner,
    staleTime: Infinity,
  });
  function choose(next: LibraryView) {
    cache.setQueryData(key, next);
    if (owner && storage.isCurrent()) void storage.setItem(draftKey(owner, "library-view"), next).catch(() => undefined);
  }
  return [saved.data ?? "grid", choose] as const;
}

/** A quiet, neutral badge only when a workout needs a look. Favorites show as a heart instead. */
export function workoutCardBadge(workout: Pick<Workout, "extraction_warnings">) {
  return workout.extraction_warnings?.length ? "Check details" : undefined;
}

export function workoutCardMeta(workout: Workout, includeOrigin = false) {
  return [
    workoutKindLabel(workout.kind),
    workout.estimated_minutes ? `${workout.estimated_minutes} min` : null,
    includeOrigin ? workoutOrigin(workout) : null,
  ].filter(Boolean).join(" · ");
}

export function workoutCountLabel(total: number, archived = false) {
  return `${total} ${archived ? "archived " : ""}${total === 1 ? "workout" : "workouts"}`;
}

/** Use the first loaded workout cover from each collection until the server sends previews. */
export function collectionCovers(workouts: Workout[]) {
  const covers = new Map<string, string>();
  for (const workout of workouts) {
    if (!workout.source_thumbnail_url) continue;
    for (const id of workout.organization?.collection_ids ?? [])
      if (!covers.has(id)) covers.set(id, workout.source_thumbnail_url);
  }
  return covers;
}

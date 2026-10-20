import { useEffect, useState } from "react";
import type { Storage } from "./drafts";
import { draftKey } from "./drafts";
import { workoutKindLabel, workoutOrigin } from "./labels";
import type { Workout } from "./models";

export type LibraryView = "grid" | "list";

/** Remember grid or list per account on this device. Starts as a grid until the saved choice loads. */
export function useLibraryView(storage: Storage & { isCurrent(): boolean }, owner: string) {
  const [view, setView] = useState<LibraryView>("grid");
  useEffect(() => {
    let live = true;
    if (!owner) return;
    void storage.getItem(draftKey(owner, "library-view"))
      .then((saved) => { if (live) setView(saved === "list" ? "list" : "grid"); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [storage, owner]);
  function choose(next: LibraryView) {
    setView(next);
    if (owner && storage.isCurrent()) void storage.setItem(draftKey(owner, "library-view"), next).catch(() => undefined);
  }
  return [view, choose] as const;
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

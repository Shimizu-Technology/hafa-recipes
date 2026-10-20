import type { ImportJob } from "./capture";
import type { Workout } from "./models";

/** A pasted link is worth sending only when it has a scheme and a real-looking host. */
export function linkLooksComplete(value: string) {
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && /\.[a-z0-9-]{2,}$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** The one-line summary on the composer's settings row. */
export function importSettingsSummary({ discover, isPublic, notes, notesApply }: {
  discover: boolean; isPublic: boolean; notes: string; notesApply: boolean;
}) {
  const parts = [
    ...(discover ? [isPublic ? "Public" : "Private"] : []),
    ...(notesApply ? [notes.trim() ? "Extra notes added" : "No extra notes"] : []),
  ];
  return parts.join(" · ");
}

const kindLabels: Record<NonNullable<Workout["capture_kind"]>, string> = {
  url: "Link", shared: "Shared link", text: "Pasted text", images: "Photos", document: "Document",
};
function host(url?: string | null) {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}
export function importedFrom(workout: Pick<Workout, "capture_kind" | "source_url" | "source_creator">) {
  return workout.source_creator?.trim() || host(workout.source_url) || (workout.capture_kind ? kindLabels[workout.capture_kind] : "");
}

export type RecentImport = { id: string; title: string; detail: string; thumbnail?: string | null };
/**
 * Saved imports for the Add tab. Server import jobs are purged after a day, so
 * the newest imported library workouts keep the section useful afterwards.
 */
export function recentImports(jobs: ImportJob[] | undefined, workouts: Workout[] | undefined, generation: number | null | undefined, limit = 5) {
  const seen = new Set<string>();
  const items: RecentImport[] = [];
  const add = (item: RecentImport) => {
    if (seen.has(item.id) || items.length >= limit) return;
    seen.add(item.id); items.push(item);
  };
  const library = new Map((workouts ?? []).map(workout => [workout.id, workout]));
  for (const job of jobs ?? []) {
    if (job.generation !== generation || !job.accepted_workout_id) continue;
    const saved = library.get(job.accepted_workout_id);
    add(saved ? fromWorkout(saved) : {
      id: job.accepted_workout_id,
      title: job.result?.workout?.title ?? job.result?.source.title ?? "Imported workout",
      detail: job.result?.source.creator?.trim() || host(job.result?.source.url) || "",
    });
  }
  // Shared-link copies were sent by someone else, not imported from a source.
  for (const workout of workouts ?? []) if (workout.capture_kind && workout.capture_kind !== "shared") add(fromWorkout(workout));
  return items;
}
function fromWorkout(workout: Workout): RecentImport {
  return { id: workout.id, title: workout.title, detail: importedFrom(workout), thumbnail: workout.source_thumbnail_url };
}

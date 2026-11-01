import type { AuthoredWorkout } from "./models";
import { isTimedFormat, openLadder, unsetRotation } from "./timed-execution";
export interface MissingDetail { key: string; label: string; block?: string; exercise?: number }
/** Unknown source facts are review prompts, never invented defaults or save errors. */
export function missingDetails(w: AuthoredWorkout): MissingDetail[] {
  const items: MissingDetail[] = [];
  if (!w.equipment_required?.length) items.push({ key: "equipment", label: "Equipment not specified" });
  for (const b of w.blocks) {
    // A timed format supplies its own rest: the rest of each EMOM minute, Tabata's rest interval,
    // or none at all for an AMRAP or for-time effort. Asking for rest there would be wrong.
    const timed = isTimedFormat(b.execution) ? b.execution : null;
    if (!b.execution && b.rounds == null && b.grouping !== "sequential")
      items.push({ key: `${b.id}:rounds`, block: b.id, label: `${b.label}: rounds not specified` });
    if (timed && timed.mode !== "for_time" && timed.intervals == null && !(timed.mode === "emom" && openLadder(b)))
      items.push({ key: `${b.id}:intervals`, block: b.id, label: `${b.label}: number of intervals not specified` });
    if (timed && unsetRotation(timed, b))
      items.push({ key: `${b.id}:rotation`, block: b.id, label: `${b.label}: one move per interval or every move each interval not specified` });
    if (!b.execution && b.rounds !== 1 && b.rest_between_rounds_seconds == null && b.grouping !== "sequential")
      items.push({ key: `${b.id}:rest`, block: b.id, label: `${b.label}: rest between rounds not specified` });
    b.exercises.forEach((e, i) => {
      const add = (field: string, text: string) => items.push({ key: `${b.id}:${i}:${field}`, block: b.id, exercise: i, label: `${e.name}: ${text}` });
      if (e.sets == null && b.rounds == null && !b.execution) add("sets", "sets not specified");
      // Inside work/rest the work interval is the dose; a rep scheme or ladder sets reps per round.
      if (e.reps_min == null && e.duration_seconds == null && e.distance_meters == null && !e.rep_scheme?.length && !e.ladder && timed?.mode !== "work_rest")
        add("target", "reps, time or distance not specified");
      if (e.rest_seconds == null && !b.execution) add("rest", "rest not specified");
    });
  }
  return items;
}

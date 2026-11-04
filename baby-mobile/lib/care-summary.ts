import type { BabyRecord, DeviceState } from "./models";
import { mutationRecordId, pendingRecords } from "./outbox";
import { dayRange, dayTotals, mergedMs, onDay, recordDay, type CareDay } from "./tracker";

const count = (day: CareDay, kind: "feeding" | "diaper") => (kind === "feeding" ? day.feeding.count : day.diapers.count);

/**
 * The API's days with this phone's queued changes laid over them, by the same rules. Each change swaps what the API
 * has for what's queued. Sleep spans merge, so a day with a queued sleep is summed again: the API's spans for the
 * sleeps not touched, and the queued ones. The total stays the API's if it didn't send spans, because this phone only
 * holds some of the day's sleeps and adding up those would lose the rest.
 */
export function dayOverlay(state: DeviceState, childId: string | null, timeZone?: string | null, now = new Date()) {
  const rows = pendingRecords(state).filter((row) => row.child_id === childId),
    touched = new Map<string, BabyRecord>();
  for (const change of state.outbox) {
    if (change.type === "import" || change.type === "child_birth") continue;
    const id = mutationRecordId(change), held = state.records.find((row) => row.id === id) ?? (change.type === "delete" ? change.record : undefined);
    if (id && held && held.child_id === childId) touched.set(id, held);
  }
  const before = [...touched.values()], changed = new Set<string | undefined>(state.outbox.map(mutationRecordId)),
    after = rows.filter((row) => changed.has(row.id));
  return (base: CareDay | undefined, key: string): CareDay => {
    if (!base) return dayTotals(rows, key, timeZone, now);
    if (!before.length && !after.length) return base;
    const was = dayTotals(before, key, timeZone, now), will = dayTotals(after, key, timeZone, now),
      moved = (group: "pee" | "poo" | "dry" | "count") => Math.max(0, base.diapers[group] - was.diapers[group] + will.diapers[group]),
      feeds = Math.max(0, count(base, "feeding") - count(was, "feeding") + count(will, "feeding")),
      diapers = moved("count"),
      sleeps = (list: BabyRecord[]) => list.filter((row) => row.kind === "sleep" && onDay(row, key, timeZone, now)),
      sleeping = sleeps(before).length + sleeps(after).length > 0,
      startedOpen = (list: BabyRecord[]) => sleeps(list).some((row) => !row.data.end_at && recordDay(row.occurred_at, timeZone) === key);
    let sleep = base.sleep, slept = base.dots.includes("sleep") || sleeps(after).length > 0;
    if (sleeping && base.sleep.spans) {
      const { from, to } = dayRange(key, timeZone),
        kept = base.sleep.spans.filter((span) => !changed.has(span.record_id)).map((span) => [span.from, span.to] as const),
        queued = sleeps(after).flatMap((row) => (row.data.end_at ? [[row.occurred_at, row.data.end_at] as const] : [])),
        total_minutes = mergedMs([...kept, ...queued], from, to, now) / 60_000,
        // The API's dot with no minutes is a sleep still going. It stays unless that sleep is the one queued here.
        stillOpen = !base.sleep.total_minutes && base.dots.includes("sleep") && !startedOpen(before);
      sleep = { ...base.sleep, total_minutes };
      slept = total_minutes > 0 || stillOpen || startedOpen(after);
    }
    return { date: key, feeding: { count: feeds }, diapers: { count: diapers, pee: moved("pee"), poo: moved("poo"), dry: moved("dry") }, sleep,
      dots: [feeds && "feeding", diapers && "diaper", slept && "sleep"].filter(Boolean) as string[] };
  };
}

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import type { BabyRecord, Child } from "./models";
import { replaceRecord } from "./outbox";
import { byStart, matchesTiming, timingContext } from "./timing";

/** Saved tips for where the parent is now (or next), from the API with the cached copy as the offline answer. */
export function useTimingTips(child: Child | null, mode: "now" | "upcoming", limit: number, now: Date) {
  const b = useBaby(),
    context = timingContext(child, now),
    [page, setPage] = useState<{ key: string; ids: string[]; total: number } | null>(null);
  const key = JSON.stringify([b.owner, b.state.bootstrap?.generation, child?.id, child?.due_date, child?.birth_date, mode, context?.value]);
  useFocusEffect(useCallback(() => {
    if (!child || !context) return;
    let active = true;
    const lease = b.api.lease();
    void b.api.records({ kind: "source", timing: mode, timing_child_id: child.id, limit })
      .then(async (response) => {
        b.api.assertLease(lease);
        if (!active) return;
        await b.commit((s) => ({ ...s, records: response.items.reduce(replaceRecord, s.records) }));
        if (active) setPage({ key, ids: response.items.map((row) => row.id), total: response.total });
      })
      .catch(() => active && setPage(null));
    return () => { active = false; };
  }, [key]));
  if (!context) return { rows: [] as BabyRecord[], total: 0 };
  const current = page?.key === key ? page : null,
    rows = current
      ? current.ids.flatMap((id) => b.records.filter((row) => row.id === id))
      : b.records.filter((row) => matchesTiming(row, mode, context)).sort(mode === "upcoming" ? byStart(context.stage) : () => 0);
  return { rows: rows.slice(0, limit), total: current?.total ?? rows.length };
}

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import type { BabyRecord, Child } from "./models";
import { replaceRecord } from "./outbox";
import { libraryRows } from "./library-history";
import { byStart, timingContext } from "./timing";

/** Saved tips for where the parent is now (or next), from the API with the cached copy as the offline answer.
 * `today` is the profile's calendar date. Unsynced edits overlay the server's page, as in Saved. */
export function useTimingTips(child: Child | null, mode: "now" | "upcoming", limit: number, today: Date) {
  const b = useBaby(),
    context = timingContext(child, today),
    [page, setPage] = useState<{ key: string; ids: string[] } | null>(null);
  const generation = b.state.bootstrap?.generation,
    key = JSON.stringify([b.owner, generation, child?.id, child?.due_date, child?.birth_date, mode, context?.stage, context?.value]);
  useFocusEffect(useCallback(() => {
    if (!child || !context) return;
    let active = true;
    const lease = b.api.lease();
    void b.api.records({ kind: "source", timing: mode, timing_child_id: child.id, limit })
      .then(async (response) => {
        b.api.assertLease(lease);
        if (!active) return;
        await b.commit((s) => {
          b.api.assertLease(lease);
          if (!active || s.bootstrap?.generation !== generation) return s;
          return { ...s, records: response.items.reduce(replaceRecord, s.records) };
        });
        if (active) setPage({ key, ids: response.items.map((row) => row.id) });
      })
      .catch(() => active && setPage(null));
    return () => { active = false; };
  }, [key]));
  if (!child || !context) return { rows: [] as BabyRecord[] };
  const current = page?.key === key ? page : null,
    order = new Map(current?.ids.map((id, index) => [id, index])),
    rows = libraryRows(b.state, { kind: "source", childId: null, query: "", timing: { mode, childId: child.id, context } }, current?.ids ?? null);
  // Server order when online (a local edit that now fits goes first); soonest first for what's coming up.
  rows.sort(mode === "upcoming" ? byStart(context.stage) : current ? (a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1) : () => 0);
  return { rows: rows.slice(0, limit) };
}

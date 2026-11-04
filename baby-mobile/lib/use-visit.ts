import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import type { BabyRecord, Kind } from "./models";
import { allPages } from "./use-events";
import { withVisitRows } from "./visits";

/**
 * What a visit's screen has to hold: this visit's own questions and notes, asked for by its id so private journal
 * entries aren't read to find them, and with `loose`, every question, for the ones she can add.
 */
export function visitReads(id: string, loose: boolean) {
  const kinds: Kind[] = loose ? ["question", "journal"] : ["question"];
  return [
    { filters: { kinds, event_id: id }, belongs: (row: BabyRecord) => row.data.event_id === id && kinds.includes(row.kind) },
    ...(loose ? [{ filters: { kind: "question" as const }, belongs: (row: BabyRecord) => row.kind === "question" }] : []),
  ];
}
/** Keeps this phone's copy of them, read on focus, however old they are, so they're here with no signal. */
export function useVisitRecords(id: string | undefined, loose = false) {
  const b = useBaby(), latest = useRef(b);
  latest.current = b;
  useFocusEffect(useCallback(() => {
    if (!id) return;
    let active = true;
    const account = latest.current, lease = account.api.lease(), generation = account.state.bootstrap?.generation;
    void (async () => {
      for (const { filters, belongs } of visitReads(id, loose)) {
        const rows = await allPages((page) => account.api.records({ ...filters, ...page }));
        if (!active || !account.current()) return;
        await account.commit((state) => {
          account.api.assertLease(lease);
          return state.bootstrap?.generation === generation ? withVisitRows(state, belongs, rows, true) : state;
        });
      }
    })().catch(() => undefined);
    return () => { active = false; };
  }, [id, loose, b.state.bootstrap?.generation]));
}

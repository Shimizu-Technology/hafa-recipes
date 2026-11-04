import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import type { BabyRecord, Kind } from "./models";
import { withVisitRows } from "./visits";

const pageLimit = 100, pagesLimit = 5;

/**
 * Keeps this phone's copy of doctor questions and, when a screen needs them, journal entries, read on focus. A phone only
 * holds the newest few at first, the API has no way to ask for one event's, and they have to be here with no signal.
 */
export function useVisitRecords(kinds: readonly Kind[]) {
  const b = useBaby(), latest = useRef(b), asked = kinds.join();
  latest.current = b;
  useFocusEffect(useCallback(() => {
    let active = true;
    const account = latest.current, lease = account.api.lease(), generation = account.state.bootstrap?.generation;
    void (async () => {
      for (const kind of kinds) {
        const rows: BabyRecord[] = [];
        let complete = false;
        for (let page = 0; page < pagesLimit && !complete && active; page++) {
          const answer = await account.api.records({ kind, limit: pageLimit, offset: page * pageLimit || undefined });
          rows.push(...answer.items);
          complete = !answer.has_more;
        }
        if (!active || !account.current()) return;
        await account.commit((state) => {
          account.api.assertLease(lease);
          return state.bootstrap?.generation === generation ? withVisitRows(state, [kind], rows, complete) : state;
        });
      }
    })().catch(() => undefined);
    return () => { active = false; };
  }, [asked, b.state.bootstrap?.generation]));
}

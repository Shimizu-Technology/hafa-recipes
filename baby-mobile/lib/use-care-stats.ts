import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import { messageFor } from "./models";
import type { CareStats, StatsChoice } from "./care-stats";

/** `/care/stats` while Stats is showing. Reads on focus and whenever a queued change leaves, as the Day view's totals do. */
export function useCareStats(choice: StatsChoice | null, childId: string | null) {
  const b = useBaby(), key = choice && JSON.stringify([b.owner, b.state.bootstrap?.generation, childId, choice]),
    waiting = b.state.outbox.length,
    [answer, setAnswer] = useState<{ key: string | null; stats?: CareStats; error?: string } | null>(null),
    asked = useRef(0),
    read = useCallback(() => {
      if (!choice) return Promise.resolve();
      const ticket = ++asked.current;
      return b.api.careStats(choice, childId).then(
        (stats) => { if (ticket === asked.current) setAnswer({ key, stats }); },
        // What's on screen stays, with word that it couldn't be brought up to date.
        (e) => { if (ticket === asked.current) setAnswer((prior) => ({ key, stats: prior?.key === key ? prior.stats : undefined, error: messageFor(e) })); });
    }, [key]);
  useFocusEffect(useCallback(() => { void read(); return () => { asked.current++; }; }, [read, waiting]));
  const current = answer?.key === key ? answer : undefined;
  return { stats: current?.stats, error: current?.error, loading: !!choice && !current, refresh: read };
}

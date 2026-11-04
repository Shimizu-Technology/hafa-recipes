import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import { messageFor } from "./models";
import type { CareStats, StatsChoice } from "./care-stats";

/** A rolling 24 hours loses and gains a minute each minute. */
const rollingPollMs = 60_000;

/**
 * `/care/stats` while Stats is showing, and when it was read. Reads on focus, on coming back to the app, whenever the
 * queue changes, and each minute for a rolling range. Only the API's numbers: `waitingEntries` says what they're missing.
 */
export function useCareStats(choice: StatsChoice | null, childId: string | null) {
  const b = useBaby(), key = choice && JSON.stringify([b.owner, b.state.bootstrap?.generation, b.state.bootstrap?.profile.timezone, childId, choice]),
    queue = b.state.outbox.map((change) => change.id).join(),
    rolling = choice?.range === "24h",
    [answer, setAnswer] = useState<{ key: string | null; stats?: CareStats; fetchedAt?: Date; error?: string } | null>(null),
    asked = useRef(0),
    read = useCallback(() => {
      if (!choice) return Promise.resolve();
      const ticket = ++asked.current, fetchedAt = new Date();
      return b.api.careStats(choice, childId).then(
        (stats) => { if (ticket === asked.current) setAnswer({ key, stats, fetchedAt }); },
        // What's on screen stays, with word of when it's from.
        (e) => { if (ticket === asked.current) setAnswer((prior) => ({ ...(prior?.key === key ? prior : { key }), error: messageFor(e) })); });
    }, [key]);
  useFocusEffect(useCallback(() => {
    void read();
    if (!choice) return () => { asked.current++; };
    const timer = rolling ? setInterval(() => { if (AppState.currentState === "active") void read(); }, rollingPollMs) : undefined,
      back = AppState.addEventListener("change", (state) => { if (state === "active") void read(); });
    return () => { asked.current++; clearInterval(timer); back.remove(); };
  }, [read, queue, rolling]));
  const current = answer?.key === key ? answer : undefined;
  return { stats: current?.stats, fetchedAt: current?.fetchedAt, error: current?.error, loading: !!choice && !current, refresh: read };
}

import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import type { CareDay } from "./tracker";

export const summaryPollMs = 15_000;

/**
 * `/care/summary` for a range of calendar days, looked up by day. It's undefined until it answers, and days then come
 * from this phone. Reads again on focus and whenever a queued change leaves, because that change is now in its totals.
 */
export function useCareSummary(childId: string | null, from: string, to: string, { poll = false } = {}) {
  const b = useBaby(), key = JSON.stringify([b.owner, b.state.bootstrap?.generation, childId, from, to]),
    waiting = b.state.outbox.length,
    [answer, setAnswer] = useState<{ key: string; days: Record<string, CareDay> } | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    const read = () => b.api.careSummary(from, to, childId).then((result) => {
      if (active) setAnswer({ key, days: Object.fromEntries(result.days.map((day) => [day.date, day])) });
    }).catch(() => undefined);
    void read();
    const timer = poll ? setInterval(() => { if (AppState.currentState === "active") void read(); }, summaryPollMs) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [key, waiting, poll]));
  return answer?.key === key ? answer.days : undefined;
}

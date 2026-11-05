import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import { otherDays } from "./care-days";
import { spacesLive } from "./spaces";
import type { CareDay } from "./tracker";

export const summaryPollMs = 15_000;

/**
 * `/care/summary` for a range of calendar days, looked up by day. It's undefined until it answers, and days then come
 * from this phone. Reads again on focus and whenever a queued change leaves, because that change is now in its totals,
 * and when another phone's changes arrive: on a timer if the API can't say when.
 */
export function useCareSummary(childId: string | null, from: string, to: string, { poll = false } = {}) {
  const b = useBaby(), key = JSON.stringify([b.owner, b.state.bootstrap?.generation, childId, from, to]),
    waiting = b.state.outbox.length,
    [answer, setAnswer] = useState<{ key: string; days: Record<string, CareDay> } | null>(null),
    asked = useRef(0), shown = useRef(0), timed = poll && !spacesLive(b.state.bootstrap), tick = b.changeTick ?? 0;
  useFocusEffect(useCallback(() => {
    let active = true;
    const read = () => {
      // Answers can come back out of order. Only a newer question's answer replaces what's on screen.
      const ticket = ++asked.current;
      return b.api.careSummary(from, to, childId).then((result) => {
        if (!active || ticket < shown.current) return;
        shown.current = ticket;
        setAnswer({ key, days: Object.fromEntries(result.days.map((day) => [day.date, day])) });
      }).catch(() => undefined);
    };
    void read();
    const timer = timed ? setInterval(() => { if (AppState.currentState === "active") void read(); }, summaryPollMs) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [key, waiting, timed, tick]));
  return answer?.key === key ? answer.days : undefined;
}

/** Which days hold a note, question, contraction or kick session, by record, read again as `useCareSummary` is. */
export function useOtherDays(childId: string | null, from: string, to: string) {
  const b = useBaby(), timezone = b.state.bootstrap?.profile.timezone, key = JSON.stringify([b.owner, b.state.bootstrap?.generation, childId, from, to]),
    waiting = b.state.outbox.length, tick = b.changeTick ?? 0,
    [answer, setAnswer] = useState<{ key: string; days: ReadonlyMap<string, readonly string[]> } | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    void otherDays(b, childId, from, to, timezone, () => active).then((days) => { if (active) setAnswer({ key, days }); }).catch(() => undefined);
    return () => { active = false; };
  }, [key, waiting, tick]));
  return answer?.key === key ? answer.days : undefined;
}

/** Everything deleted while this screen has been up. A delete leaves the queue before the next answer comes back, and its dot goes with it. */
export function useDeleted() {
  const b = useBaby(), gone = useRef(new Set<string>());
  for (const change of b.state.outbox) if (change.type === "delete") gone.current.add(change.record.id);
  return gone.current;
}

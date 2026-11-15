import { useEffect, useRef, useState } from "react";
import { useBaby } from "@/lib/context";
import { defaultRecipients, newsAvailable, nextHold, sendPending } from "../lib/family-news";

/** Sends labor and birth news she chose to send, once there's signal and (for a birth) the date has landed. */
export function NewsRunner() {
  const b = useBaby(), pending = b.state.pendingNews ?? [], running = useRef(false), [tick, setTick] = useState(0);
  const latest = useRef(b);
  latest.current = b;
  const waiting = pending.length > 0 && newsAvailable(b.state.bootstrap);
  useEffect(() => {
    if (!waiting || !b.online || running.current) return;
    running.current = true;
    const now = latest.current;
    // "The other parents", for news kept with no signal: the family of that baby, read as it goes.
    const parents = async (childId: string) => {
      const space = now.state.bootstrap?.children.find((child) => child.id === childId)?.space_id;
      return space ? defaultRecipients((await now.api.familyMembers(space)).items, now.owner) : [];
    };
    void sendPending(now.state, now.api.familyNews, now.commit, parents).catch(() => undefined)
      .finally(() => { running.current = false; });
  }, [waiting, b.online, b.state.pendingNews, b.state.outbox, tick]);
  // When Undo's window closes on something held, look again then.
  useEffect(() => {
    const at = nextHold(b.state.pendingNews);
    if (!Number.isFinite(at)) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, at - Date.now()) + 100);
    return () => clearTimeout(timer);
  }, [b.state.pendingNews]);
  // A server hiccup isn't a state change, so look again now and then while something's waiting.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [waiting]);
  return null;
}

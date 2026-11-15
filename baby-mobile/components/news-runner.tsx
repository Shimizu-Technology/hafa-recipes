import { useEffect, useRef, useState } from "react";
import { useBaby } from "@/lib/context";
import { newsAvailable, sendPending } from "../lib/family-news";

/** Sends labor and birth news she chose to send, once there's signal and (for a birth) the date has landed. */
export function NewsRunner() {
  const b = useBaby(), pending = b.state.pendingNews ?? [], running = useRef(false), [tick, setTick] = useState(0);
  const latest = useRef(b);
  latest.current = b;
  const waiting = pending.length > 0 && newsAvailable(b.state.bootstrap);
  useEffect(() => {
    if (!waiting || !b.online || running.current) return;
    running.current = true;
    void sendPending(latest.current.state, latest.current.api.familyNews, latest.current.commit).catch(() => undefined)
      .finally(() => { running.current = false; });
  }, [waiting, b.online, b.state.pendingNews, b.state.outbox, tick]);
  // A server hiccup isn't a state change, so look again now and then while something's waiting.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [waiting]);
  return null;
}

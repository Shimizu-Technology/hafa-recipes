import { useEffect, useRef, useState } from "react";
import { useBaby } from "@/lib/context";
import { useToast } from "@/components/ui";
import { defaultRecipients, deliveredWords, memberName, newsAbout, newsAvailable, nextHold, sendPending } from "../lib/family-news";

/**
 * Sends labor and birth news she chose to send, once there's signal and (for a birth) the date has landed. Once it's
 * gone, it says who'll get a notification and who'll only see it in the app, wherever she is by then.
 */
export function NewsRunner() {
  const b = useBaby(), toast = useToast(), pending = b.state.pendingNews ?? [], running = useRef(false), [tick, setTick] = useState(0);
  const latest = useRef(b);
  latest.current = b;
  const waiting = pending.length > 0 && newsAvailable(b.state.bootstrap);
  useEffect(() => {
    if (!waiting || !b.online || running.current) return;
    running.current = true;
    const now = latest.current, names: Record<string, string> = {};
    // "The other parents", for news kept with no signal: the family of that baby, read as it goes, never the person it's about.
    const parents = async (childId: string) => {
      const child = now.state.bootstrap?.children.find((one) => one.id === childId), space = child?.space_id;
      if (!space) return [];
      const { items } = await now.api.familyMembers(space);
      for (const member of items) names[member.app_user_id] = memberName(member);
      return defaultRecipients(items, now.owner, newsAbout(child));
    };
    void sendPending(now.state, now.api.familyNews, now.commit, parents)
      .then((sent) => {
        const last = sent[sent.length - 1];
        if (last) toast(deliveredWords(last.to, last.push, (id) => last.item.names?.[id] ?? names[id] ?? "Your partner"));
      })
      .catch(() => undefined)
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

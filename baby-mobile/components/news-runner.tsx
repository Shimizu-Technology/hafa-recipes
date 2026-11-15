import { useEffect, useRef, useState } from "react";
import { useBaby } from "@/lib/context";
import { useToast } from "@/components/ui";
import { clockIn } from "../lib/tracker";
import { deliveredWords, memberName, newsAvailable, nextHold, partnersFor, sendPending, skippedWords, type FamilyNow } from "../lib/family-news";

/**
 * Sends labor and birth news she chose to send, once there's signal and (for a birth) the date has landed. Once it's
 * gone, it says who'll get a notification and who'll only see it in the app, wherever she is by then, and who wasn't
 * told at all.
 */
export function NewsRunner() {
  const b = useBaby(), toast = useToast(), pending = b.state.pendingNews ?? [], running = useRef(false), [tick, setTick] = useState(0);
  const latest = useRef(b);
  latest.current = b;
  const waiting = pending.length > 0 && newsAvailable(b.state.bootstrap);
  useEffect(() => {
    if (!waiting || !b.online || running.current) return;
    running.current = true;
    const now = latest.current, names: Record<string, string> = {}, timeZone = now.state.bootstrap?.profile.timezone;
    // The family of that baby as it is now: "the other parents" for news kept with no signal (never the person it's
    // about), and who's still in it when someone she picked has left.
    const family = async (childId: string): Promise<FamilyNow> => {
      const child = now.state.bootstrap?.children.find((one) => one.id === childId), space = child?.space_id;
      if (!space) return { active: [], parents: [], names: {} };
      const { items } = await now.api.familyMembers(space);
      for (const member of items) names[member.app_user_id] = memberName(member);
      return { active: items.filter((member) => member.status === "active").map((member) => member.app_user_id),
        parents: partnersFor(items, now.owner, child), names: { ...names } };
    };
    void sendPending(now.state, now.api.familyNews, now.commit, family)
      .then(({ sent, dropped }) => {
        const words = [
          ...sent.map((one) => {
            const name = (id: string) => one.item.names?.[id] ?? names[id] ?? "Your partner";
            return [deliveredWords(one.to, one.push, name, { at: one.push_after, clock: (iso) => clockIn(new Date(iso), timeZone) }), skippedWords(one.skipped, name)]
              .filter(Boolean).join(" ");
          }),
          ...dropped.map((one) => one.message),
        ].filter(Boolean);
        if (words.length) toast(words.join(" "));
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

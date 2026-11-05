import { keyDate } from "./tracker";
import type { BabyRecord, Child } from "./models";
import { trackerById, trackerOn } from "./trackers";

export type AskAbout = "diaper" | "feed";
const trackersAsked: Record<AskAbout, readonly string[]> = { diaper: ["diaper"], feed: ["breast", "bottle"] };
/** How long with nothing logged before it asks, per EXACT_PLAN section 16. */
const quietDays: Record<AskAbout, number> = { diaper: 30, feed: 14 };
/** Where it's remembered that she was asked: in `details.tracking`, so another phone doesn't ask again. No tracker has these ids. */
const askedKey: Record<AskAbout, string> = { diaper: "asked_diaper", feed: "asked_feed" };

function pastFirstYear(birth: string | null | undefined, today: Date) {
  if (!birth) return false;
  const born = keyDate(birth);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate()) > new Date(born.getFullYear() + 1, born.getMonth(), born.getDate());
}

/** What could be asked for this baby at all, before reading a single log. Never by age alone: this only decides whether to look. */
export function suggestionsOpen(child: Child, today: Date): AskAbout[] {
  if (!pastFirstYear(child.birth_date, today)) return [];
  return (["diaper", "feed"] as const).filter((about) => child.details?.tracking?.[askedKey[about]] !== true
    && trackersAsked[about].some((id) => trackerOn(trackerById(id)!, "born", child.details)));
}

/** One question at most, from what's logged. Something logged long ago and nothing since; a tracker never used says nothing. */
export function suggestionFor(open: readonly AskAbout[], logs: Record<AskAbout, readonly Pick<BabyRecord, "occurred_at">[]>, now: Date) {
  for (const id of open) {
    const newest = Math.max(...logs[id].map((row) => new Date(row.occurred_at).getTime()));
    if (Number.isFinite(newest) && now.getTime() - newest >= quietDays[id] * 86_400_000) return { id, days: quietDays[id] };
  }
  return null;
}

/** What each answer sends. Keep is a choice too, so neither asks again. */
export function suggestionAnswer(id: AskAbout, keep: boolean): Record<string, boolean> {
  return { ...(keep ? {} : Object.fromEntries(trackersAsked[id].map((tracker) => [tracker, false]))), [askedKey[id]]: true };
}
/** The buttons this is about, as she sees them. */
export const suggestionButtons = (id: AskAbout, child: Child) => trackersAsked[id].map((tracker) => trackerById(tracker)!).filter((tracker) => trackerOn(tracker, "born", child.details));

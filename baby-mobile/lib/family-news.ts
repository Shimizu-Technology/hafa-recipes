import { ApiError } from "./api";
import type { FamilyMember } from "./family";
import type { Bootstrap, Child, DeviceState } from "./models";
import { familySpaces } from "./spaces";

/**
 * Family news: "the baby is here" and "contractions have started", pushed by the API to the family members she
 * picks. Her partner (every other parent) is picked by default; anyone else is one tap. Nothing is sent outside her
 * family space, and nothing but the app's own push: the lock screen says only that there's news.
 *
 * Kept on this phone until it's sent, like everything else, so a delivery room with no signal loses nothing. Birth
 * news waits for the birth date to land, so the API's check that the baby is born passes when it arrives.
 */
export type NewsKind = "labor" | "birth";
export interface PendingNews {
  id: string; news: NewsKind; child_id: string; to: string[]; queued_at: string;
  /** "The other parents", when she said so before the family could be read (no signal): who they are is looked up when it goes. */
  parents?: boolean;
  /** Stays on this phone while Undo is on screen, so Undo can still take it back. */
  hold_until?: string;
  /** Names as she saw them, for saying who'll be notified once it's gone. */
  names?: Record<string, string>;
}

/** The API says it can send news, and she's a parent in this baby's family (any family, without a space). */
export function newsAvailable(bootstrap: Pick<Bootstrap, "reminders" | "spaces"> | null | undefined, spaceId?: string | null) {
  return !!bootstrap?.reminders?.family_news && familySpaces(bootstrap).some((space) => space.role === "parent" && (spaceId === undefined || space.id === spaceId));
}
/**
 * Who the news is about: whoever added the pregnancy. That's the person it's added for (her own phone, at setup), and
 * moving the baby into a family keeps it. Labor and birth news is never offered to her: she's the one in labor.
 * Unknown on an API before `created_by`, when only "not me" applies.
 */
export const newsAbout = (child: Pick<Child, "created_by"> | null | undefined) => child?.created_by ?? null;
/** Everyone she could tell: active members of her family but her and the person it's about. Parents first, so Leon is never under Grandma. */
export const tellable = (members: readonly FamilyMember[], me: string | null | undefined, about?: string | null) =>
  members.filter((member) => member.status === "active" && member.app_user_id !== me && member.app_user_id !== about)
    .sort((a, b) => Number(a.role !== "parent") - Number(b.role !== "parent"));
/** Her partner by default: the other parents. Grandma and other caregivers are hers to add. */
export const defaultRecipients = (members: readonly FamilyMember[], me: string | null | undefined, about?: string | null) =>
  tellable(members, me, about).filter((member) => member.role === "parent").map((member) => member.app_user_id);
export const memberName = (member: FamilyMember) => member.display_name.trim() || (member.role === "parent" ? "Your partner" : "Family member");

const together = (names: string[]) => names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
/**
 * Once it's gone, what she's told: only someone whose phone will show it "will get a notification". The rest see it in
 * the app, and she knows to tell them another way if it can't wait. The API names no phones, only yes or no.
 */
export function deliveredWords(to: readonly string[], push: Record<string, boolean> | undefined, name: (id: string) => string) {
  if (!push) return `Sent to ${together(to.map(name))}.`;
  const buzzed = to.filter((id) => push[id]), waiting = to.filter((id) => !push[id]);
  return [
    buzzed.length ? `${together(buzzed.map(name))} will get a notification.` : "",
    waiting.length ? `${together(waiting.map(name))} ${waiting.length === 1 ? "hasn’t" : "haven’t"} turned on notifications yet, so it’ll be waiting in Håfa Baby.` : "",
  ].filter(Boolean).join(" ");
}

/** Who'd hear, in words: "Leon", "Leon and Grandma", "3 people". */
export function recipientWords(members: readonly FamilyMember[], to: readonly string[]) {
  const names = members.filter((member) => to.includes(member.app_user_id)).map(memberName);
  if (!names.length) return "";
  return names.length <= 2 ? names.join(" and ") : `${names.length} people`;
}

export function queueNews(state: DeviceState, item: PendingNews): DeviceState {
  if ((!item.to.length && !item.parents) || state.pendingNews?.some((one) => one.id === item.id)) return state;
  return { ...state, pendingNews: [...(state.pendingNews ?? []), item] };
}
export const withoutNews = (state: DeviceState, id: string): DeviceState =>
  ({ ...state, pendingNews: (state.pendingNews ?? []).filter((one) => one.id !== id) });

/** Past its Undo window, and for a birth once the date has reached the API. */
export const readyToSend = (state: Pick<DeviceState, "outbox">, item: PendingNews, now = Date.now()) =>
  (!item.hold_until || new Date(item.hold_until).getTime() <= now) &&
  (item.news !== "birth" || !state.outbox.some((m) => m.type === "child_birth" && m.child_id === item.child_id));

type Sender = (body: { id: string; news: NewsKind; child_id: string; to: string[] }) => Promise<{ push?: Record<string, boolean> } | unknown>;
export interface SentNews { item: PendingNews; to: string[]; push?: Record<string, boolean> }
/**
 * Sends what's ready. Sent, or refused for good (not in the family any more, the baby gone, too many), it leaves
 * the phone; no signal or a server hiccup, it stays for next time. Older than a day, it's no longer news.
 */
export async function sendPending(state: DeviceState, send: Sender, commit: (change: (s: DeviceState) => DeviceState) => Promise<void>,
  parents: (childId: string) => Promise<string[]> = async () => [], now = Date.now()) {
  const sent: SentNews[] = [];
  for (const item of state.pendingNews ?? []) {
    if (now - new Date(item.queued_at).getTime() > 24 * 3600_000) { await commit((s) => withoutNews(s, item.id)); continue; }
    if (!readyToSend(state, item, now)) continue;
    try {
      const to = item.parents ? [...new Set([...item.to, ...await parents(item.child_id)])] : item.to;
      if (!to.length) { await commit((s) => withoutNews(s, item.id)); continue; } // No one else in the family after all.
      const answer = await send({ id: item.id, news: item.news, child_id: item.child_id, to }) as { push?: Record<string, boolean> } | undefined;
      sent.push({ item, to, push: answer?.push });
      await commit((s) => withoutNews(s, item.id));
    } catch (failure) {
      const status = failure instanceof ApiError && !failure.local ? failure.status : 0;
      if (status === 0 || status === 401 || status === 408 || status >= 500) break;
      await commit((s) => withoutNews(s, item.id));
    }
  }
  return sent;
}

/** The earliest moment something held becomes ready, for the runner to look again then. */
export const nextHold = (items: readonly PendingNews[] | undefined, now = Date.now()) =>
  Math.min(...(items ?? []).map((item) => item.hold_until ? new Date(item.hold_until).getTime() : Infinity).filter((at) => at > now));

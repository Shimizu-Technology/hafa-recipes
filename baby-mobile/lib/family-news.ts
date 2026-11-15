import { ApiError, NotBornYet } from "./api";
import type { FamilyMember } from "./family";
import type { Bootstrap, DeviceState } from "./models";
import { statedExpecting } from "./expecting";
import { familySpaces } from "./spaces";

/**
 * Family news: "the baby is here" and "contractions have started", pushed by the API to the family members she
 * picks. Her partner (every other parent) is picked by default; anyone else is one tap. Nothing is sent outside her
 * family space, and nothing but the app's own push: the lock screen says only that there's news.
 *
 * Kept on this phone until it's sent, like everything else, so a delivery room with no signal loses nothing. Birth
 * news waits for the birth date to land, so the API's check that the baby is born passes when it arrives. Nothing is
 * ever dropped quietly: if news can't go, or can't go to someone, she's told who wasn't told.
 */
export type NewsKind = "labor" | "birth";
export interface PendingNews {
  id: string; news: NewsKind; child_id: string; to: string[]; queued_at: string;
  /** "The other parents", when she said so before the family could be read (no signal): who they are is looked up when it goes. */
  parents?: boolean;
  /** Stays on this phone until then: while Undo is on screen, so Undo can still take it back, or until it's worth trying again. */
  hold_until?: string;
  /** Names as she saw them, for saying who'll be notified once it's gone. */
  names?: Record<string, string>;
  /** People she picked who'd left the family by the time it went: kept here, so a retry still tells her who wasn't told. */
  skipped?: string[];
}

/** The API says it can send news, and she's a parent in this baby's family (any family, without a space). */
export function newsAvailable(bootstrap: Pick<Bootstrap, "reminders" | "spaces"> | null | undefined, spaceId?: string | null) {
  return !!bootstrap?.reminders?.family_news && familySpaces(bootstrap).some((space) => space.role === "parent" && (spaceId === undefined || space.id === spaceId));
}
/** Who the news is about: who the family says is expecting (`expecting_member`), or null while that isn't settled. */
export const newsAbout = statedExpecting;
/** Everyone she could tell: active members of her family but her. Parents first, so Leon is never under Grandma. */
export const tellable = (members: readonly FamilyMember[], me: string | null | undefined) =>
  members.filter((member) => member.status === "active" && member.app_user_id !== me)
    .sort((a, b) => Number(a.role !== "parent") - Number(b.role !== "parent"));
/**
 * Her partner by default: the other parents, but not the person it's about, who's listed unticked. Grandma is hers to
 * add. While who's expecting isn't settled (`about` null), nobody is ticked: any parent might be her.
 */
export const defaultRecipients = (members: readonly FamilyMember[], me: string | null | undefined, about: string | null) =>
  about === null ? [] : tellable(members, me).filter((member) => member.role === "parent" && member.app_user_id !== about).map((member) => member.app_user_id);
/**
 * "Tell your partner" with no signal, resolved as it goes: the other parents of whoever pressed it, unless the family
 * has confirmed someone else is expecting. A guess never decides it: a guess naming Leon on Kami's phone still tells Leon.
 */
export const partnersFor = (members: readonly FamilyMember[], me: string | null | undefined, child: Parameters<typeof statedExpecting>[0]) =>
  defaultRecipients(members, me, statedExpecting(child) ?? me ?? null);
export const memberName = (member: FamilyMember) => member.display_name.trim() || (member.role === "parent" ? "Your partner" : "Family member");

export const together = (names: string[]) => names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
/**
 * Once it's gone, what she's told: only someone whose phone will show it "will get a notification". The rest see it in
 * the app, and she knows to tell them another way if it can't wait. The API names no phones, only yes or no.
 */
export function deliveredWords(to: readonly string[], push: NewsAnswer["push"], name: (id: string) => string,
  later: { at?: Record<string, string>; clock?: (iso: string) => string } = {}) {
  if (!push) return to.length ? `Sent to ${together(to.map(name))}.` : "";
  const buzzed = to.filter((id) => push[id] === true), quiet = to.filter((id) => push[id] === "after_quiet_hours"),
    waiting = to.filter((id) => !push[id]);
  const after = (id: string) => later.at?.[id] && later.clock ? ` at ${later.clock(later.at[id])}` : " when their quiet hours end";
  return [
    buzzed.length ? `${together(buzzed.map(name))} will get a notification.` : "",
    ...quiet.map((id) => `${name(id)} will get it${after(id)}, after their quiet hours.`),
    waiting.length ? `${together(waiting.map(name))} ${waiting.length === 1 ? "hasn’t" : "haven’t"} turned on notifications yet, so it’ll be waiting in Håfa Baby.` : "",
  ].filter(Boolean).join(" ");
}
/** Someone she picked who'd left the family by the time it went. */
export const skippedWords = (ids: readonly string[], name: (id: string) => string) => ids.length
  ? `${together(ids.map(name))} ${ids.length === 1 ? "is" : "are"} no longer in your family, so the news didn’t go to them.` : "";

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

/** The API's answer. `push` is per person: their phone will show it, will after their quiet hours, or won't. */
export interface NewsAnswer {
  id?: string; sent_to?: string[]; skipped?: string[];
  push?: Record<string, boolean | "after_quiet_hours">;
  /** When someone's quiet hours end, for "after_quiet_hours". */
  push_after?: Record<string, string>;
}
type Sender = (body: { id: string; news: NewsKind; child_id: string; to: string[] }) => Promise<NewsAnswer | undefined>;
/** The family as it is now: who's in it, its parents, and their names. */
export interface FamilyNow { active: string[]; parents: string[]; names: Record<string, string> }
export interface SentNews { item: PendingNews; to: string[]; skipped: string[]; push?: NewsAnswer["push"]; push_after?: Record<string, string> }
export interface DroppedNews { item: PendingNews; message: string }
const tryLater = { limit: 5 * 60_000, notBorn: 60_000 };
const nobody: FamilyNow = { active: [], parents: [], names: {} };
const dayOld = 24 * 3600_000;
/**
 * Sends what's ready. No signal or a server hiccup, it stays. Too many this hour, or the birth not on the API yet, it
 * stays and tries again a little later. Someone who left the family since she picked them is left out and named.
 * Anything that can't go at all, or is a day old, leaves the phone with words saying so: never quietly.
 */
export async function sendPending(state: DeviceState, send: Sender, commit: (change: (s: DeviceState) => DeviceState) => Promise<void>,
  family: (childId: string) => Promise<FamilyNow> = async () => nobody, now = Date.now()) {
  const sent: SentNews[] = [], dropped: DroppedNews[] = [];
  try {
    await sendEach(state, send, commit, family, now, sent, dropped);
  } catch {
    // A write to this phone failed partway: whatever already went, or was already let go, is still said. The item
    // whose write failed is still on the phone, so it's said nothing about and tried again.
  }
  return { sent, dropped };
}
/**
 * Before the first send, the people it's going to are kept on the item: a retry after a lost answer then goes to the
 * same people under the same id, so the API sees the same news rather than a change (and refuses it).
 */
const settleRecipients = (commit: (change: (s: DeviceState) => DeviceState) => Promise<void>, id: string, to: string[], names: Record<string, string>,
  skipped: string[] = []) =>
  commit((s) => ({ ...s, pendingNews: (s.pendingNews ?? []).map((one) => one.id !== id ? one
    : { ...one, to, parents: undefined, names: { ...names, ...one.names }, ...(skipped.length ? { skipped: [...new Set([...(one.skipped ?? []), ...skipped])] } : {}) }) }));
async function sendEach(state: DeviceState, send: Sender, commit: (change: (s: DeviceState) => DeviceState) => Promise<void>,
  family: (childId: string) => Promise<FamilyNow>, now: number, sent: SentNews[], dropped: DroppedNews[]) {
  for (const item of state.pendingNews ?? []) {
    const named = (seen: Record<string, string> = {}) => (id: string) => item.names?.[id] ?? seen[id] ?? "Your partner";
    // Who it was for, by name when every name is known.
    const whom = (seen: Record<string, string> = {}) => item.to.length && item.to.every((id) => item.names?.[id] ?? seen[id])
      ? together(item.to.map(named(seen))) : "the people you picked";
    if (now - new Date(item.queued_at).getTime() > dayOld) {
      await commit((s) => withoutNews(s, item.id));
      dropped.push({ item, message: `Your news to ${whom()} couldn’t be sent within a day, so it wasn’t. Tell them another way.` });
      continue;
    }
    if (!readyToSend(state, item, now)) continue;
    let seen: Record<string, string> = {};
    try {
      // Anyone a first try already left out, kept from then, so the result can still name them.
      let to = item.to, skipped: string[] = [...(item.skipped ?? [])];
      if (item.parents) {
        const current = await family(item.child_id);
        seen = current.names;
        to = [...new Set([...item.to, ...current.parents])];
      }
      if (!to.length) {
        await commit((s) => withoutNews(s, item.id));
        dropped.push({ item, message: "No one else is in your family yet, so no one was told." });
        continue;
      }
      if (item.parents) await settleRecipients(commit, item.id, to, seen);
      let answer: NewsAnswer | undefined;
      try {
        answer = await send({ id: item.id, news: item.news, child_id: item.child_id, to });
      } catch (failure) {
        // An API that refuses the whole message for one person who left: read the family again and send to the rest.
        if (!(failure instanceof ApiError) || failure.local || failure.status !== 422) throw failure;
        const current = await family(item.child_id);
        seen = { ...seen, ...current.names };
        const left = to.filter((id) => !current.active.includes(id));
        to = to.filter((id) => current.active.includes(id));
        if (!left.length) throw failure;
        skipped = [...skipped, ...left];
        if (to.length) {
          // The smaller set and who was left out are kept together: if this send's answer is lost, the retry says both.
          await settleRecipients(commit, item.id, to, seen, left);
          answer = await send({ id: item.id, news: item.news, child_id: item.child_id, to });
        }
      }
      skipped = [...new Set([...skipped, ...(answer?.skipped ?? [])])];
      to = answer?.sent_to ?? to.filter((id) => !skipped.includes(id));
      await commit((s) => withoutNews(s, item.id));
      if (to.length) sent.push({ item, to, skipped, push: answer?.push, push_after: answer?.push_after });
      else dropped.push({ item, message: skippedWords(skipped, named(seen)) || "No one else is in your family yet, so no one was told." });
    } catch (failure) {
      const status = failure instanceof ApiError && !failure.local ? failure.status : 0;
      if (status === 0 || status === 401 || status === 408 || status >= 500) break;
      if (status === 429 || failure instanceof NotBornYet) {
        // Kept, and tried again later rather than every few seconds.
        const later = new Date(now + (status === 429 ? tryLater.limit : tryLater.notBorn)).toISOString();
        await commit((s) => ({ ...s, pendingNews: (s.pendingNews ?? []).map((one) => one.id === item.id ? { ...one, hold_until: later } : one) }));
        continue;
      }
      await commit((s) => withoutNews(s, item.id));
      dropped.push({ item, message: `Your news couldn’t be sent to ${whom(seen)}. Tell them another way if it can’t wait.` });
    }
  }
}

/** The earliest moment something held becomes ready, for the runner to look again then. */
export const nextHold = (items: readonly PendingNews[] | undefined, now = Date.now()) =>
  Math.min(...(items ?? []).map((item) => item.hold_until ? new Date(item.hold_until).getTime() : Infinity).filter((at) => at > now));

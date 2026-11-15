import { ApiError } from "./api";
import type { FamilyMember } from "./family";
import type { Bootstrap, DeviceState } from "./models";
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
export interface PendingNews { id: string; news: NewsKind; child_id: string; to: string[]; queued_at: string }

/** The API says it can send news, and she's a parent in a family. */
export function newsAvailable(bootstrap: Pick<Bootstrap, "reminders" | "spaces"> | null | undefined) {
  return !!bootstrap?.reminders?.family_news && familySpaces(bootstrap).some((space) => space.role === "parent");
}
/** Everyone she could tell: active members of her family but her. */
export const tellable = (members: readonly FamilyMember[], me: string | null | undefined) =>
  members.filter((member) => member.status === "active" && member.app_user_id !== me);
/** Her partner by default: the other parents. Grandma and other caregivers are hers to add. */
export const defaultRecipients = (members: readonly FamilyMember[], me: string | null | undefined) =>
  tellable(members, me).filter((member) => member.role === "parent").map((member) => member.app_user_id);
export const memberName = (member: FamilyMember) => member.display_name.trim() || (member.role === "parent" ? "Your partner" : "Family member");

/** Who'd hear, in words: "Leon", "Leon and Grandma", "3 people". */
export function recipientWords(members: readonly FamilyMember[], to: readonly string[]) {
  const names = members.filter((member) => to.includes(member.app_user_id)).map(memberName);
  if (!names.length) return "";
  return names.length <= 2 ? names.join(" and ") : `${names.length} people`;
}

export function queueNews(state: DeviceState, item: PendingNews): DeviceState {
  if (!item.to.length || state.pendingNews?.some((one) => one.id === item.id)) return state;
  return { ...state, pendingNews: [...(state.pendingNews ?? []), item] };
}
export const withoutNews = (state: DeviceState, id: string): DeviceState =>
  ({ ...state, pendingNews: (state.pendingNews ?? []).filter((one) => one.id !== id) });

/** Birth news goes once the birth date has reached the API; labor news goes straight away. */
export const readyToSend = (state: Pick<DeviceState, "outbox">, item: PendingNews) =>
  item.news !== "birth" || !state.outbox.some((m) => m.type === "child_birth" && m.child_id === item.child_id);

type Sender = (body: Omit<PendingNews, "queued_at">) => Promise<unknown>;
/**
 * Sends what's ready. Sent, or refused for good (not in the family any more, the baby gone, too many), it leaves
 * the phone; no signal or a server hiccup, it stays for next time. Older than a day, it's no longer news.
 */
export async function sendPending(state: DeviceState, send: Sender, commit: (change: (s: DeviceState) => DeviceState) => Promise<void>, now = Date.now()) {
  const sent: string[] = [];
  for (const item of state.pendingNews ?? []) {
    if (now - new Date(item.queued_at).getTime() > 24 * 3600_000) { await commit((s) => withoutNews(s, item.id)); continue; }
    if (!readyToSend(state, item)) continue;
    try {
      const { queued_at: _, ...body } = item;
      await send(body);
      sent.push(item.id);
      await commit((s) => withoutNews(s, item.id));
    } catch (failure) {
      const status = failure instanceof ApiError && !failure.local ? failure.status : 0;
      if (status === 0 || status === 401 || status === 408 || status >= 500) break;
      await commit((s) => withoutNews(s, item.id));
    }
  }
  return sent;
}

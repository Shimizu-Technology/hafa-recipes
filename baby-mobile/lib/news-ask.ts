import type { DeviceState } from "./models";
import { familySpaces } from "./spaces";
import { shownPrefs } from "./reminder-prefs";

/**
 * The one time this phone asks so family news can reach it: on someone else's phone in the family, before the birth,
 * when the person expecting could tell them "it's time". Answered either way, it isn't asked again; Reminders keeps a
 * way to turn notifications on later. Whether the phone can still ask is the caller's to check: it's native.
 */
export function newsAskFor(state: Pick<DeviceState, "bootstrap" | "newsAskSeen" | "reminderPrefs" | "outbox">, owner: string | null | undefined) {
  const bootstrap = state.bootstrap;
  if (!bootstrap?.reminders?.family_news || state.newsAskSeen || shownPrefs(state).kinds.family_news?.enabled === false) return null;
  const families = new Set(familySpaces(bootstrap).map((space) => space.id));
  // Someone else in the family is expecting, by the family's word: an unconfirmed guess of themselves is theirs to settle.
  const expected = bootstrap.children.find((child) => !child.birth_date && child.due_date && child.space_id && families.has(child.space_id)
    && child.details?.expecting_member && child.details.expecting_member !== owner);
  if (!expected) return null;
  const name = bootstrap.people?.[expected.details!.expecting_member!]?.trim();
  return { name: name || "your family", reason: `So ${name || "your family"} can tell you the moment labor starts, even with Håfa Baby closed.` };
}

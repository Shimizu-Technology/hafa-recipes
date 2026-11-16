import type { FamilyMember } from "./family";
import type { Child } from "./models";

type Member = Pick<FamilyMember, "app_user_id" | "role" | "status">;
const parentsOf = (members: readonly Member[]) => members.filter((member) => member.role === "parent" && member.status === "active");

/**
 * Who's expecting, as far as this phone can say. The family says it in `expecting_member`. The API fills it in
 * with whoever added the pregnancy, unconfirmed, because the person adding it may be her partner. So:
 * - known: confirmed by someone in the family, or there's no other parent to mix her up with;
 * - ask: an unconfirmed guess, or nothing, while the family has another parent (once it's been read), on every
 *   parent's phone alike: a guess naming Leon must never make Kami's phone say "Leon's contractions".
 * Until then the screen uses everyday words and ticks no one.
 */
export function expectingFor(child: Pick<Child, "birth_date" | "details"> | null | undefined, owner: string | null | undefined,
  family: { inFamily: boolean; members: readonly Member[] | null }) {
  const stated = child?.details?.expecting_member ?? null, confirmed = child?.details?.expecting_confirmed === true;
  if (!child || child.birth_date) return { id: null, ask: false };
  const parents = family.members ? parentsOf(family.members) : null,
    others = parents ? parents.filter((member) => member.app_user_id !== owner) : null,
    alone = !family.inFamily || (others !== null && others.length === 0),
    valid = !!stated && (!parents || parents.some((member) => member.app_user_id === stated));
  const id = valid && (confirmed || alone) ? stated : alone ? owner ?? null : null;
  return { id, ask: !id && !!others?.length };
}
/** With only the child to go on: who the family confirmed is expecting, or null. A guess is never taken as an answer. */
export const statedExpecting = (child: Pick<Child, "details"> | null | undefined) =>
  child?.details?.expecting_confirmed === true ? child.details.expecting_member ?? null : null;

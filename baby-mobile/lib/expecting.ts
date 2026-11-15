import type { FamilyMember } from "./family";
import type { Child } from "./models";

type Member = Pick<FamilyMember, "app_user_id" | "role" | "status">;
const parentsOf = (members: readonly Member[]) => members.filter((member) => member.role === "parent" && member.status === "active");

/**
 * Who's expecting, as far as this phone can say. The family says it in `expecting_member`. The API fills it in
 * with whoever added the pregnancy, unconfirmed, because the person adding it may be her partner. So:
 * - known: confirmed, or it names someone other than this phone's owner, or there's no other parent to mix up;
 * - ask: it isn't known and the family has another parent (once the family has been read), so the screen asks once.
 * Until then the screen uses everyday words and ticks no one it isn't sure of.
 */
export function expectingFor(child: Pick<Child, "birth_date" | "details"> | null | undefined, owner: string | null | undefined,
  family: { inFamily: boolean; members: readonly Member[] | null }) {
  const stated = child?.details?.expecting_member ?? null, confirmed = child?.details?.expecting_confirmed === true;
  if (!child || child.birth_date) return { id: null, ask: false };
  const parents = family.members ? parentsOf(family.members) : null,
    others = parents ? parents.filter((member) => member.app_user_id !== owner) : null,
    alone = !family.inFamily || (others !== null && others.length === 0),
    valid = !!stated && (!parents || parents.some((member) => member.app_user_id === stated));
  const id = valid && (confirmed || stated !== owner || alone) ? stated : alone ? owner ?? null : null;
  return { id, ask: !id && !!others?.length };
}
/** The same answer with only the child to go on: what's stored, unless it's this phone's owner and unconfirmed. */
export const statedExpecting = (child: Pick<Child, "details"> | null | undefined, owner: string | null | undefined) => {
  const stated = child?.details?.expecting_member ?? null;
  return stated && (child?.details?.expecting_confirmed === true || stated !== owner) ? stated : null;
};

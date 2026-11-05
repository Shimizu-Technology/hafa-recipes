import type { Bootstrap } from "./models";
import { familySpaces, spacesLive } from "./spaces";

const destinations = /^(personal|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** A capture's tag, `owner:generation[:destination]`. One from a build before spaces has no destination, and all it had was personal. */
function tagged(scope: string) {
  const parts = scope.split(":"), destination = parts.length > 2 && destinations.test(parts[parts.length - 1]) ? parts.pop()! : "personal",
    generation = Number(parts.pop());
  return { owner: parts.join(":"), generation, destination };
}
export const shareOwner = (scope?: string | null) => (scope ? tagged(scope).owner : undefined);
/**
 * Whether this account can take this capture. It has to be its own, and not from before its space was cleared. A family
 * it's since left can't say, and the capture is still its own words, so that one's fine.
 */
export function captureBelongs(scope: string | undefined, owner: string, bootstrap?: Bootstrap) {
  if (!scope) return false;
  const tag = tagged(scope);
  if (tag.owner !== owner) return false;
  const family = familySpaces(bootstrap).find((space) => space.id === tag.destination);
  return tag.destination === "personal" ? tag.generation === bootstrap?.generation : !family || tag.generation === family.generation;
}
/** Where new captures go: the family for its parents, and otherwise this account's own space. */
export function shareDestination(bootstrap?: Bootstrap) {
  if (!spacesLive(bootstrap)) return undefined;
  const family = familySpaces(bootstrap)[0];
  return family?.role === "parent" ? family.id : bootstrap!.personal_space_id;
}
/** How the credential's destination is written in the native tag. */
export const sessionScope = (bootstrap: Bootstrap | undefined, session: { space_id?: string; generation: number }) =>
  !spacesLive(bootstrap) || !session.space_id ? null : session.space_id === bootstrap!.personal_space_id ? "personal" : session.space_id;
/**
 * Where a capture on this phone goes. Its own tag decides, so one made before a family existed stays personal: pending
 * private work is never published. One made for a family this account has since left may already be there under its id,
 * where this phone can't see it. So it stays that family's, held as Not sent, and only she can copy it to her own space.
 */
export function captureDestination(scope: string | undefined, bootstrap?: Bootstrap): { space_id?: string; left_space?: string } {
  if (!spacesLive(bootstrap)) return {};
  const destination = scope ? tagged(scope).destination : "personal", family = familySpaces(bootstrap).find((space) => space.id === destination);
  if (family?.role === "parent") return { space_id: family.id };
  if (destination !== "personal" && !family) return { space_id: destination, left_space: destination };
  return { space_id: bootstrap!.personal_space_id };
}
/** A personal capture from before this account's space was cleared. Nothing can use it, and it mustn't hold the queue up. */
export function captureStale(scope: string | undefined, owner: string, bootstrap?: Bootstrap) {
  if (!scope) return false;
  const tag = tagged(scope);
  return tag.owner === owner && tag.destination === "personal" && !!bootstrap && tag.generation < bootstrap.generation;
}

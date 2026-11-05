import type { BabyRecord, Bootstrap, Kind } from "./models";
import { familySpaces } from "./spaces";

const inFamily = (row: Pick<BabyRecord, "space_id">, bootstrap?: Bootstrap) => !!row.space_id && familySpaces(bootstrap).some((space) => space.id === row.space_id);
/** Who logged a shared entry, for a sentence. Nothing outside a family, where it can only be her. */
export function loggedByName(row: Pick<BabyRecord, "space_id" | "created_by">, bootstrap: Bootstrap | undefined, owner: string) {
  if (!inFamily(row, bootstrap)) return "";
  // Still queued on this phone, so the API hasn't said, and it's hers.
  if (row.created_by === undefined || row.created_by === owner) return "you";
  if (row.created_by === null || !(row.created_by in (bootstrap?.people ?? {}))) return "a former member";
  return bootstrap?.people?.[row.created_by] || "a family member";
}
/** Things two parents might both log for the same moment. Two kick sessions or notes at once are just two. */
const duplicable = new Set<Kind>(["feeding", "sleep", "diaper", "pumping", "medicine", "temperature"]);
const windowMs = 10 * 60_000;
/** The other parent's entry for what looks like the same moment. It's only ever a hint: nothing is merged or removed. */
export function duplicateOf(row: BabyRecord, rows: readonly BabyRecord[], owner: string, families?: ReadonlySet<string>) {
  if (!duplicable.has(row.kind) || (families && !families.has(row.space_id ?? ""))) return undefined;
  // Still queued here means hers, so her own two never look like two people's.
  const at = new Date(row.occurred_at).getTime(), author = (one: BabyRecord) => (one.created_by === undefined ? owner : one.created_by);
  return rows.find((other) => other.id !== row.id && other.kind === row.kind && other.child_id === row.child_id && other.space_id === row.space_id &&
    author(other) !== author(row) && other.data.method === row.data.method && other.data.contents === row.data.contents && other.data.label === row.data.label && other.data.type === row.data.type &&
    (row.kind !== "medicine" || other.title === row.title) && Math.abs(new Date(other.occurred_at).getTime() - at) <= windowMs);
}
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** On the record itself, where she can act on it. */
export const duplicateHint = (other: BabyRecord, bootstrap: Bootstrap | undefined, owner: string) =>
  `${capital(loggedByName(other, bootstrap, owner))} logged one too, at about the same time. If it’s the same one, you can delete this one.`;
/** What a row's second line adds: someone else's name, and whether it looks logged twice. */
export function familyLine(row: BabyRecord, rows: readonly BabyRecord[], bootstrap: Bootstrap | undefined, owner: string) {
  const name = loggedByName(row, bootstrap, owner);
  if (!name) return "";
  const other = duplicateOf(row, rows, owner), twice = other && loggedByName(other, bootstrap, owner);
  return [name === "you" ? "" : `Logged by ${name}`, twice && twice !== name ? `${capital(twice)} logged one too` : ""].filter(Boolean).join(" · ");
}

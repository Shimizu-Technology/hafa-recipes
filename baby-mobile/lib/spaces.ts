import type { Bootstrap, BabySpace } from "./models";

/** The API listed this account's spaces, which it only does with the family stack on. */
export const spacesLive = (bootstrap?: Pick<Bootstrap, "spaces"> | null) => !!bootstrap?.spaces?.length;
export const familySpaces = (bootstrap?: Pick<Bootstrap, "spaces"> | null): BabySpace[] => (bootstrap?.spaces ?? []).filter((space) => space.kind === "family");
/**
 * What a screen's data depends on: which families, and in what role. The personal space is left out, so the flag turning
 * on doesn't remount an open editor, and so is the access version, which also moves when a file is taken off a record.
 */
export const accessKey = (bootstrap?: Pick<Bootstrap, "spaces"> | null) =>
  familySpaces(bootstrap).map((space) => `${space.id}:${space.role}`).sort().join("|");

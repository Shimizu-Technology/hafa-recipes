import type { Workout } from "./models";
export interface Organization {
  revision: number;
  favorite: boolean;
  archived: boolean;
  tags: string[];
  collection_ids: string[];
  duplicate_of_workout_id: string | null;
  duplicate_of_revision: number | null;
}
export interface Collection {
  id: string;
  generation: number;
  revision: number;
  title: string;
  workout_count: number;
  created_at: string;
  updated_at: string;
}
export interface LibraryFilters {
  q?: string;
  equipment?: string;
  kind?: Workout["kind"];
  favorite_only?: boolean;
  include_archived?: boolean;
  archived_only?: boolean;
  collection_id?: string;
  tags?: string[];
}
export interface LibraryPage {
  items: Workout[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_cursor: string | null;
}
export interface OrganizationWrite {
  expected_revision: number;
  favorite?: boolean;
  archived?: boolean;
  tags?: string[];
  collection_ids?: string[];
}
export const emptyOrganization = (): Organization => ({
  revision: 0,
  favorite: false,
  archived: false,
  tags: [],
  collection_ids: [],
  duplicate_of_workout_id: null,
  duplicate_of_revision: null,
});
export function libraryQuery(filters: LibraryFilters, cursor?: string | null) {
  if ((filters.q?.length ?? 0) > 100 || (filters.equipment?.length ?? 0) > 100)
    throw Error("Keep search and equipment filters within 100 characters.");
  const problems = organizationErrors(filters.tags ?? [], []);
  if (problems.length) throw Error(problems.join(" "));
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("cursor", cursor);
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const tag of value) params.append(key, tag);
    } else params.set(key, String(value));
  }
  return params.toString();
}
export function tagsFromText(value: string) {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function organizationErrors(tags: string[], collections: string[]) {
  const errors: string[] = [];
  if (tags.length > 20 || tags.some((tag) => tag.length > 40 || /[\x00-\x1f\x7f]/.test(tag)))
    errors.push("Use up to 20 tags, each at most 40 characters.");
  if (collections.length > 20) errors.push("Choose up to 20 collections per workout.");
  return errors;
}
export function collectionTitleError(value: string) {
  return !value.trim() || value.trim().length > 100 || /[\x00-\x1f\x7f]/.test(value)
    ? "Use a collection name of 1–100 characters."
    : null;
}

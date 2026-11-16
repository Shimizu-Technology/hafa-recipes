import type { BabyRecord } from "./models";

/** The categories the share sheet offers: the session's own space's, most recently changed first. None named means one space. */
export function shareCategories(rows: readonly BabyRecord[], spaceId?: string, limit = 8) {
  return rows
    .filter((row) => row.kind === "collection" && (!spaceId || row.space_id === spaceId))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit)
    .map((row) => ({ id: row.id, title: row.title }));
}

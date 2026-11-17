import type { BabyRecord, Child } from "./models";
import { babyAgeCard, type TimingContext } from "./timing";

export interface SavedSection { category: BabyRecord; count: number; rows: BabyRecord[] }

const newest = (a: BabyRecord, b: BabyRecord) => b.occurred_at.localeCompare(a.occurred_at);

/**
 * All saved as shelves: each of her categories with its newest few posts, then the posts in none. One pass over the
 * posts, so a library of hundreds stays quick. A post in several categories shows under each; the child filter keeps
 * posts for everyone, as the list does.
 */
export function savedSections(records: readonly BabyRecord[], categories: readonly BabyRecord[], childId: string | null, limit = 3) {
  const posts = records.filter((row) => row.kind === "source" && (!childId || !row.child_id || row.child_id === childId)).sort(newest),
    byId = new Map(posts.map((row) => [row.id, row])), filed = new Set<string>();
  const sections: SavedSection[] = categories.flatMap((category) => {
    const members = [...new Set(category.data.record_ids ?? [])].flatMap((id) => byId.get(id) ?? []).sort(newest);
    members.forEach((row) => filed.add(row.id));
    // Unfiltered, the category's own count is right even before every post has reached this phone.
    const count = childId ? members.length : Math.max(members.length, category.data.record_ids?.length ?? 0);
    return members.length ? [{ category, count, rows: members.slice(0, limit) }] : [];
  });
  const loose = posts.filter((row) => !filed.has(row.id));
  return { sections, unsorted: { count: loose.length, rows: loose.slice(0, limit) } };
}

/** "For week 37" while pregnant; after birth the age Today shows, "For week 3" then "For month 4". */
export function nowShelfTitle(context: TimingContext | null, child: Pick<Child, "birth_date"> | null | undefined, now = new Date()) {
  if (!context) return "";
  if (context.stage === "pregnancy") return `For week ${context.value}`;
  const card = child?.birth_date ? babyAgeCard(child.birth_date, now) : null;
  return card ? `For ${card.unit} ${card.age}` : "For now";
}

/** The first sentence of a summary, for a one-line takeaway under a post's title. */
export function takeaway(summary?: string | null) {
  const text = (summary ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

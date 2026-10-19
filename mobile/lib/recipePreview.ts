/**
 * Read-only recipe summary taken from list, search, saved or Discover caches.
 * It lets the detail screen show the title and photo while the full recipe
 * loads. It deliberately carries no ownership, visibility or editing fields:
 * every action stays gated on the real recipe response.
 */
export type RecipePreview = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  totalTime: string | null;
  servings: number | null;
};

const MAX_DEPTH = 4;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function toPreview(record: Record<string, unknown>): RecipePreview {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  const servings = record.servings;
  return {
    id: String(record.id),
    title: String(record.title),
    thumbnailUrl: text(record.thumbnail_url),
    sourceUrl: text(record.source_url),
    totalTime: text(record.total_time),
    servings: typeof servings === 'number' && Number.isFinite(servings) && servings > 0 ? servings : null,
  };
}

function search(value: unknown, id: string, depth: number): RecipePreview | null {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = search(entry, id, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  // A list card: { id, title, ... }. Detail responses nest the title under `extracted`.
  if (record.id === id && typeof record.title === 'string' && record.title.trim()) {
    return toPreview(record);
  }
  // Infinite pages, paginated responses, ingredient-search responses and their matches.
  for (const key of ['pages', 'items', 'results', 'recipe'] as const) {
    if (key in record) {
      const found = search(record[key], id, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Find the first cached list card for `id` across cached query data. */
export function findRecipePreview(cached: readonly unknown[], id: string | undefined): RecipePreview | null {
  if (!id) return null;
  for (const data of cached) {
    const found = search(data, id, 0);
    if (found) return found;
  }
  return null;
}

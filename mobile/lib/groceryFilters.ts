import type { GroceryItem } from '@/types/recipe';

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .trim();
}

/**
 * Filters grocery items using every word in the query. The searchable text
 * mirrors what shoppers can see in a row plus its recipe and contributor.
 */
export function filterGroceryItems(
  items: readonly GroceryItem[],
  query: string,
): GroceryItem[] {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];

  return items.filter((item) => {
    const searchableText = normalizeSearchText([
      item.quantity,
      item.unit,
      item.name,
      item.notes,
      item.recipe_title,
      item.added_by_name,
    ].filter((value): value is string => Boolean(value) && value !== 'null').join(' '));

    return terms.every((term) => searchableText.includes(term));
  });
}

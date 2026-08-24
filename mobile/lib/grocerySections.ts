import type { GroceryItem } from '@/types/recipe';

export const OTHER_GROCERY_SECTION_KEY = 'other-items';
export const OTHER_GROCERY_SECTION_TITLE = 'Other Items';

export interface GrocerySection {
  key: string;
  title: string;
  recipeId: string | null;
  data: GroceryItem[];
  checkedCount: number;
  totalCount: number;
}

function recipeSectionKey(item: GroceryItem): string | null {
  if (item.recipe_id) return `recipe:${item.recipe_id}`;
  const title = item.recipe_title?.trim();
  return title ? `recipe-title:${title.normalize('NFKC').toLocaleLowerCase('en')}` : null;
}

function compareSections(a: GrocerySection, b: GrocerySection): number {
  const byTitle = a.title.localeCompare(b.title, 'en', {
    sensitivity: 'base',
    numeric: true,
  });
  return byTitle || a.key.localeCompare(b.key, 'en');
}

/**
 * Builds the grocery list's canonical presentation sections.
 *
 * The API order remains authoritative inside each section (unchecked first,
 * then newest first). Recipe sections are sorted by display title with a
 * stable key tie-breaker, and manually added items always appear last.
 */
export function groupGroceryItems(items: readonly GroceryItem[]): GrocerySection[] {
  const recipeSections = new Map<string, GrocerySection>();
  const otherItems: GroceryItem[] = [];

  for (const item of items) {
    const key = recipeSectionKey(item);
    if (!key) {
      otherItems.push(item);
      continue;
    }

    const existing = recipeSections.get(key);
    if (existing) {
      existing.data.push(item);
      existing.totalCount += 1;
      if (item.checked) existing.checkedCount += 1;
      continue;
    }

    recipeSections.set(key, {
      key,
      title: item.recipe_title?.trim() || 'Recipe Items',
      recipeId: item.recipe_id ?? null,
      data: [item],
      checkedCount: item.checked ? 1 : 0,
      totalCount: 1,
    });
  }

  const sections = [...recipeSections.values()].sort(compareSections);
  if (otherItems.length > 0) {
    sections.push({
      key: OTHER_GROCERY_SECTION_KEY,
      title: OTHER_GROCERY_SECTION_TITLE,
      recipeId: null,
      data: otherItems,
      checkedCount: otherItems.filter((item) => item.checked).length,
      totalCount: otherItems.length,
    });
  }
  return sections;
}

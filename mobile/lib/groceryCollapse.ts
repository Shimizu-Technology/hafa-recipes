import AsyncStorage from '@react-native-async-storage/async-storage';

import { OTHER_GROCERY_SECTION_KEY, type GrocerySection } from '@/lib/grocerySections';

/** App builds before per-list storage kept one global array of keys or titles. */
export const LEGACY_COLLAPSED_SECTIONS_KEY = 'grocery_collapsed_sections';
const STORAGE_PREFIX = 'grocery_collapsed_sections:v2:';

/**
 * Which grocery sections are collapsed on this device, and when that last
 * changed. The app and the home-screen widget each keep a copy; the newer one
 * wins, so a tap in either place shows up in the other.
 */
export interface CollapsedSections {
  keys: string[];
  /** Milliseconds since 1970, or 0 when the choice predates timestamps. */
  updatedAt: number;
}

export const EMPTY_COLLAPSED_SECTIONS: CollapsedSections = { keys: [], updatedAt: 0 };

export function collapsedSectionsStorageKey(listId: string): string {
  return `${STORAGE_PREFIX}${listId}`;
}

function parseKeys(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((key) => typeof key === 'string') ? value : null;
}

export function parseCollapsedSections(stored: string | null): CollapsedSections | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    const legacyKeys = parseKeys(parsed);
    if (legacyKeys) return { keys: legacyKeys, updatedAt: 0 };
    if (parsed && typeof parsed === 'object') {
      const record = parsed as { keys?: unknown; updatedAt?: unknown };
      const keys = parseKeys(record.keys);
      const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
      if (keys) return { keys, updatedAt };
    }
  } catch {
    // A damaged value only loses which sections were folded.
  }
  return null;
}

/** Loads this list's choice, falling back to the old global choice once. */
export async function loadCollapsedSections(listId: string): Promise<CollapsedSections> {
  try {
    const stored = parseCollapsedSections(await AsyncStorage.getItem(collapsedSectionsStorageKey(listId)));
    if (stored) return stored;
    return parseCollapsedSections(await AsyncStorage.getItem(LEGACY_COLLAPSED_SECTIONS_KEY)) ?? EMPTY_COLLAPSED_SECTIONS;
  } catch {
    return EMPTY_COLLAPSED_SECTIONS;
  }
}

export async function saveCollapsedSections(listId: string, value: CollapsedSections): Promise<void> {
  try {
    await AsyncStorage.setItem(collapsedSectionsStorageKey(listId), JSON.stringify(value));
  } catch {
    // Folding is a convenience; the list still works if it cannot be saved.
  }
}

/** Old builds saved a section's title; current builds save its stable key. */
export function isSectionCollapsed(keys: readonly string[], section: Pick<GrocerySection, 'key' | 'title'>): boolean {
  return keys.includes(section.key) || keys.includes(section.title);
}

export function setSectionsCollapsed(
  current: CollapsedSections,
  sections: readonly Pick<GrocerySection, 'key' | 'title'>[],
  collapsed: boolean,
  now = Date.now(),
): CollapsedSections {
  const changing = new Set(sections.flatMap((section) => [section.key, section.title]));
  const keys = current.keys.filter((key) => !changing.has(key));
  if (collapsed) keys.push(...sections.map((section) => section.key));
  return { keys, updatedAt: now };
}

export function toggleSectionCollapsed(
  current: CollapsedSections,
  section: Pick<GrocerySection, 'key' | 'title'>,
  now = Date.now(),
): CollapsedSections {
  return setSectionsCollapsed(current, [section], !isSectionCollapsed(current.keys, section), now);
}

/** Last writer wins. Equal times keep the app's copy. */
export function newerCollapsedSections(app: CollapsedSections, widget: CollapsedSections | null): 'app' | 'widget' {
  return widget && widget.updatedAt > app.updatedAt ? 'widget' : 'app';
}

/**
 * A list holding only items added by hand reads as a plain list: an "Other"
 * header with nothing to tell apart adds a tap target and no meaning. The
 * widget follows the same rule.
 */
export function showsSectionHeaders(sections: readonly Pick<GrocerySection, 'key'>[]): boolean {
  return !(sections.length === 1 && sections[0].key === OTHER_GROCERY_SECTION_KEY);
}

/** "2 of 13 left", "3 left" when nothing is checked yet, or "All done". */
export function sectionProgressLabel(section: Pick<GrocerySection, 'checkedCount' | 'totalCount'>): string {
  const left = section.totalCount - section.checkedCount;
  if (left <= 0) return 'All done';
  return section.checkedCount === 0 ? `${left} left` : `${left} of ${section.totalCount} left`;
}

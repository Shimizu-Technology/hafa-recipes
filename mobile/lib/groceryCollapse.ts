import AsyncStorage from '@react-native-async-storage/async-storage';

import { OTHER_GROCERY_SECTION_KEY, type GrocerySection } from '@/lib/grocerySections';

/** App builds before per-list storage kept one global array of keys or titles. */
export const LEGACY_COLLAPSED_SECTIONS_KEY = 'grocery_collapsed_sections';
/**
 * Every account and list's folds, in one record so they can be pruned
 * together. Cleared with the account's other private grocery data.
 */
export const COLLAPSED_SECTIONS_STORAGE_KEY = '@hafa_grocery_collapsed_sections_v3';
/** Lists this device remembers folds for; the least recently changed go first. */
export const MAX_COLLAPSED_SECTION_RECORDS = 8;

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

/**
 * Folds belong to one account's view of one list. Members of a shared list
 * see the same list ID, so the API's account scope keeps their folds apart.
 */
export interface CollapseScope {
  accountScopeId: string;
  listId: string;
}

export const EMPTY_COLLAPSED_SECTIONS: CollapsedSections = { keys: [], updatedAt: 0 };

export function isValidCollapseScope(scope: Partial<CollapseScope> | null | undefined): scope is CollapseScope {
  const valid = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256;
  return Boolean(scope) && valid(scope!.accountScopeId) && valid(scope!.listId);
}

export function collapseScopeKey(scope: CollapseScope): string {
  return JSON.stringify([scope.accountScopeId, scope.listId]);
}

function parseKeys(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((key) => typeof key === 'string') ? value : null;
}

export function parseCollapsedSections(stored: string | null): CollapsedSections | null {
  if (!stored) return null;
  try {
    return parseRecord(JSON.parse(stored));
  } catch {
    // A damaged value only loses which sections were folded.
  }
  return null;
}

function parseRecord(parsed: unknown): CollapsedSections | null {
  const legacyKeys = parseKeys(parsed);
  if (legacyKeys) return { keys: legacyKeys, updatedAt: 0 };
  if (parsed && typeof parsed === 'object') {
    const record = parsed as { keys?: unknown; updatedAt?: unknown };
    const keys = parseKeys(record.keys);
    const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
    if (keys) return { keys, updatedAt };
  }
  return null;
}

type StoredRecords = Record<string, CollapsedSections>;

async function readRecords(): Promise<StoredRecords> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)) ?? '{}');
    const records: StoredRecords = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        const record = parseRecord(value);
        if (record) records[key] = record;
      }
    }
    return records;
  } catch {
    return {};
  }
}

/** Keeps the scope just written and the most recently changed others. */
export function pruneCollapsedRecords(records: StoredRecords, keep: string, limit = MAX_COLLAPSED_SECTION_RECORDS): StoredRecords {
  const others = Object.entries(records)
    .filter(([key]) => key !== keep)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, limit - 1));
  return Object.fromEntries([...(records[keep] ? [[keep, records[keep]] as const] : []), ...others]);
}

// Saves read, change and write the shared record, so they run one at a time.
let storageChain: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageChain.then(operation, operation);
  storageChain = result.then(() => undefined, () => undefined);
  return result;
}

// Clearing private grocery data bumps this, so a save queued before the clear
// cannot write the cleared record back.
let storageGeneration = 0;

/** Removes every saved fold, after any save already running has finished. */
export function clearCollapsedSections(): Promise<void> {
  storageGeneration += 1;
  return serialized(() => AsyncStorage.multiRemove([COLLAPSED_SECTIONS_STORAGE_KEY, LEGACY_COLLAPSED_SECTIONS_KEY]));
}

async function writeRecord(scope: CollapseScope, value: CollapsedSections): Promise<void> {
  const key = collapseScopeKey(scope);
  const records = { ...(await readRecords()), [key]: value };
  await AsyncStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(pruneCollapsedRecords(records, key)));
}

/**
 * Loads this account and list's choice. The old global choice moves into the
 * first scope that loads after the upgrade, then is removed so no other
 * account or list inherits it.
 */
export function loadCollapsedSections(scope: CollapseScope): Promise<CollapsedSections> {
  const generation = storageGeneration;
  return serialized(async () => {
    try {
      if (generation !== storageGeneration) return EMPTY_COLLAPSED_SECTIONS;
      const stored = (await readRecords())[collapseScopeKey(scope)];
      if (stored) return stored;
      const legacy = parseCollapsedSections(await AsyncStorage.getItem(LEGACY_COLLAPSED_SECTIONS_KEY));
      if (!legacy) return EMPTY_COLLAPSED_SECTIONS;
      await writeRecord(scope, legacy);
      await AsyncStorage.removeItem(LEGACY_COLLAPSED_SECTIONS_KEY);
      return legacy;
    } catch {
      return EMPTY_COLLAPSED_SECTIONS;
    }
  });
}

export function saveCollapsedSections(scope: CollapseScope, value: CollapsedSections): Promise<void> {
  const generation = storageGeneration;
  return serialized(async () => {
    try {
      if (generation === storageGeneration) await writeRecord(scope, value);
    } catch {
      // Folding is a convenience; the list still works if it cannot be saved.
    }
  });
}

/**
 * Old builds saved a section's title, which the widget cannot match. Rewrites
 * titles as section keys and drops sections no longer on the list, so the app
 * and the widget fold the same groups. `sections` must be the whole list,
 * not a filtered view of it.
 */
export function canonicalCollapsedKeys(
  keys: readonly string[],
  sections: readonly Pick<GrocerySection, 'key' | 'title'>[],
): string[] {
  const sectionKeys = new Set(sections.map((section) => section.key));
  const canonical: string[] = [];
  for (const key of keys) {
    const matches = sectionKeys.has(key)
      ? [key]
      : sections.filter((section) => section.title === key).map((section) => section.key);
    for (const match of matches) if (!canonical.includes(match)) canonical.push(match);
  }
  return canonical;
}

export function isSectionCollapsed(keys: readonly string[], section: Pick<GrocerySection, 'key'>): boolean {
  return keys.includes(section.key);
}

export function setSectionsCollapsed(
  current: CollapsedSections,
  sections: readonly Pick<GrocerySection, 'key'>[],
  collapsed: boolean,
  now = Date.now(),
): CollapsedSections {
  const changing = new Set(sections.map((section) => section.key));
  const keys = current.keys.filter((key) => !changing.has(key));
  if (collapsed) keys.push(...changing);
  return { keys, updatedAt: now };
}

/** Expand all unfolds every group, including ones the current view hides. */
export function expandAllSections(now = Date.now()): CollapsedSections {
  return { keys: [], updatedAt: now };
}

export function toggleSectionCollapsed(
  current: CollapsedSections,
  section: Pick<GrocerySection, 'key'>,
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

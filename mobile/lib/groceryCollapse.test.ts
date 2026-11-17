import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  },
}));

import {
  LEGACY_COLLAPSED_SECTIONS_KEY,
  collapsedSectionsStorageKey,
  isSectionCollapsed,
  loadCollapsedSections,
  newerCollapsedSections,
  parseCollapsedSections,
  saveCollapsedSections,
  sectionProgressLabel,
  setSectionsCollapsed,
  showsSectionHeaders,
  toggleSectionCollapsed,
} from './groceryCollapse';

const lasagna = { key: 'recipe:lasagna', title: 'Lasagna My Way' };
const adobo = { key: 'recipe:adobo', title: 'Adobo' };

describe('grocery collapse state', () => {
  beforeEach(() => storage.clear());

  it('saves each list separately and reads them back', async () => {
    await saveCollapsedSections('list-a', { keys: [lasagna.key], updatedAt: 10 });
    await saveCollapsedSections('list-b', { keys: [], updatedAt: 20 });
    expect(await loadCollapsedSections('list-a')).toEqual({ keys: [lasagna.key], updatedAt: 10 });
    expect(await loadCollapsedSections('list-b')).toEqual({ keys: [], updatedAt: 20 });
    expect(collapsedSectionsStorageKey('list-a')).toBe('grocery_collapsed_sections:v2:list-a');
  });

  it('keeps a fold saved by an older build until this list saves its own', async () => {
    storage.set(LEGACY_COLLAPSED_SECTIONS_KEY, JSON.stringify([lasagna.key, 'Adobo']));
    const loaded = await loadCollapsedSections('list-a');
    expect(loaded).toEqual({ keys: [lasagna.key, 'Adobo'], updatedAt: 0 });
    // Very old builds saved titles instead of keys.
    expect(isSectionCollapsed(loaded.keys, adobo)).toBe(true);
    await saveCollapsedSections('list-a', { keys: [], updatedAt: 5 });
    expect(await loadCollapsedSections('list-a')).toEqual({ keys: [], updatedAt: 5 });
  });

  it('treats damaged storage as nothing folded', async () => {
    storage.set(collapsedSectionsStorageKey('list-a'), '{not json');
    expect(await loadCollapsedSections('list-a')).toEqual({ keys: [], updatedAt: 0 });
    expect(parseCollapsedSections(JSON.stringify({ keys: [1, 2] }))).toBeNull();
    expect(parseCollapsedSections(JSON.stringify({ keys: ['a'] }))).toEqual({ keys: ['a'], updatedAt: 0 });
  });

  it('toggles one section and clears a legacy title along with its key', () => {
    const folded = toggleSectionCollapsed({ keys: [], updatedAt: 0 }, lasagna, 100);
    expect(folded).toEqual({ keys: [lasagna.key], updatedAt: 100 });
    expect(toggleSectionCollapsed(folded, lasagna, 200)).toEqual({ keys: [], updatedAt: 200 });
    expect(toggleSectionCollapsed({ keys: ['Adobo', lasagna.key], updatedAt: 0 }, adobo, 300)).toEqual({ keys: [lasagna.key], updatedAt: 300 });
  });

  it('collapses or expands many sections at once without duplicates', () => {
    const all = setSectionsCollapsed({ keys: [lasagna.key], updatedAt: 0 }, [lasagna, adobo], true, 7);
    expect(all).toEqual({ keys: [lasagna.key, adobo.key], updatedAt: 7 });
    expect(setSectionsCollapsed(all, [lasagna, adobo], false, 8)).toEqual({ keys: [], updatedAt: 8 });
  });

  it('lets the most recent change win between the app and the widget', () => {
    expect(newerCollapsedSections({ keys: [], updatedAt: 10 }, { keys: ['x'], updatedAt: 11 })).toBe('widget');
    expect(newerCollapsedSections({ keys: [], updatedAt: 10 }, { keys: ['x'], updatedAt: 10 })).toBe('app');
    expect(newerCollapsedSections({ keys: [], updatedAt: 10 }, null)).toBe('app');
  });

  it('hides the header for a list made only of hand-added items', () => {
    expect(showsSectionHeaders([{ key: 'other-items' }])).toBe(false);
    expect(showsSectionHeaders([{ key: 'recipe:a' }])).toBe(true);
    expect(showsSectionHeaders([{ key: 'recipe:a' }, { key: 'other-items' }])).toBe(true);
    expect(showsSectionHeaders([])).toBe(true);
  });

  it('counts what is left in words a shopper reads at a glance', () => {
    expect(sectionProgressLabel({ checkedCount: 11, totalCount: 13 })).toBe('2 of 13 left');
    expect(sectionProgressLabel({ checkedCount: 0, totalCount: 3 })).toBe('3 left');
    expect(sectionProgressLabel({ checkedCount: 4, totalCount: 4 })).toBe('All done');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
  },
}));

import {
  COLLAPSED_SECTIONS_STORAGE_KEY,
  LEGACY_COLLAPSED_SECTIONS_KEY,
  MAX_COLLAPSED_SECTION_RECORDS,
  canonicalCollapsedKeys,
  expandAllSections,
  isSectionCollapsed,
  isValidCollapseScope,
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
const accountA = (listId: string) => ({ accountScopeId: 'gacct_a', listId });
const accountB = (listId: string) => ({ accountScopeId: 'gacct_b', listId });

describe('grocery collapse state', () => {
  beforeEach(() => storage.clear());

  it('saves each list separately and reads them back', async () => {
    await saveCollapsedSections(accountA('list-a'), { keys: [lasagna.key], updatedAt: 10 });
    await saveCollapsedSections(accountA('list-b'), { keys: [], updatedAt: 20 });
    expect(await loadCollapsedSections(accountA('list-a'))).toEqual({ keys: [lasagna.key], updatedAt: 10 });
    expect(await loadCollapsedSections(accountA('list-b'))).toEqual({ keys: [], updatedAt: 20 });
    expect([...storage.keys()]).toEqual([COLLAPSED_SECTIONS_STORAGE_KEY]);
  });

  it('keeps two accounts sharing one list apart', async () => {
    await saveCollapsedSections(accountA('shared'), { keys: [lasagna.key], updatedAt: 10 });
    expect(await loadCollapsedSections(accountB('shared'))).toEqual({ keys: [], updatedAt: 0 });
    await saveCollapsedSections(accountB('shared'), { keys: [adobo.key], updatedAt: 20 });
    expect(await loadCollapsedSections(accountA('shared'))).toEqual({ keys: [lasagna.key], updatedAt: 10 });
    expect(isValidCollapseScope({ accountScopeId: '', listId: 'shared' })).toBe(false);
    expect(isValidCollapseScope({ accountScopeId: 'gacct_a', listId: '' })).toBe(false);
    expect(isValidCollapseScope(null)).toBe(false);
  });

  it('moves a fold saved by an older build into the first list that loads, once', async () => {
    storage.set(LEGACY_COLLAPSED_SECTIONS_KEY, JSON.stringify([lasagna.key, 'Adobo']));
    expect(await loadCollapsedSections(accountA('list-a'))).toEqual({ keys: [lasagna.key, 'Adobo'], updatedAt: 0 });
    expect(storage.has(LEGACY_COLLAPSED_SECTIONS_KEY)).toBe(false);
    expect(await loadCollapsedSections(accountA('list-a'))).toEqual({ keys: [lasagna.key, 'Adobo'], updatedAt: 0 });
    // Another list, or another account on this device, does not inherit it.
    expect(await loadCollapsedSections(accountB('list-a'))).toEqual({ keys: [], updatedAt: 0 });
    await saveCollapsedSections(accountA('list-a'), { keys: [], updatedAt: 5 });
    expect(await loadCollapsedSections(accountA('list-a'))).toEqual({ keys: [], updatedAt: 5 });
  });

  it('treats damaged storage as nothing folded', async () => {
    storage.set(COLLAPSED_SECTIONS_STORAGE_KEY, '{not json');
    expect(await loadCollapsedSections(accountA('list-a'))).toEqual({ keys: [], updatedAt: 0 });
    storage.set(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify({ [JSON.stringify(['gacct_a', 'list-a'])]: { keys: [1] } }));
    expect(await loadCollapsedSections(accountA('list-a'))).toEqual({ keys: [], updatedAt: 0 });
    expect(parseCollapsedSections(JSON.stringify({ keys: [1, 2] }))).toBeNull();
    expect(parseCollapsedSections(JSON.stringify({ keys: ['a'] }))).toEqual({ keys: ['a'], updatedAt: 0 });
  });

  it('remembers a bounded number of lists, dropping the least recently changed', async () => {
    for (let index = 0; index < MAX_COLLAPSED_SECTION_RECORDS + 3; index += 1) {
      await saveCollapsedSections(accountA(`list-${index}`), { keys: [lasagna.key], updatedAt: 100 + index });
    }
    // An old list is still kept while it is the one being written.
    await saveCollapsedSections(accountA('list-0'), { keys: [adobo.key], updatedAt: 1 });
    const stored = JSON.parse(storage.get(COLLAPSED_SECTIONS_STORAGE_KEY)!);
    expect(Object.keys(stored)).toHaveLength(MAX_COLLAPSED_SECTION_RECORDS);
    expect(await loadCollapsedSections(accountA('list-0'))).toEqual({ keys: [adobo.key], updatedAt: 1 });
    expect(await loadCollapsedSections(accountA('list-1'))).toEqual({ keys: [], updatedAt: 0 });
    expect(await loadCollapsedSections(accountA(`list-${MAX_COLLAPSED_SECTION_RECORDS + 2}`))).toEqual({ keys: [lasagna.key], updatedAt: 100 + MAX_COLLAPSED_SECTION_RECORDS + 2 });
  });

  it('turns old title folds into section keys and drops groups no longer on the list', () => {
    const sameTitle = { key: 'recipe:adobo-2', title: 'Adobo' };
    const other = { key: 'other-items', title: 'Other Items' };
    expect(canonicalCollapsedKeys(['Adobo', lasagna.key, 'Other Items'], [lasagna, adobo, sameTitle, other]))
      .toEqual([adobo.key, sameTitle.key, lasagna.key, other.key]);
    // Lasagna's items were cleared: its fold goes with it.
    expect(canonicalCollapsedKeys([lasagna.key, adobo.key], [adobo])).toEqual([adobo.key]);
    // A recipe group keeps its key when the recipe is renamed.
    expect(canonicalCollapsedKeys([lasagna.key], [{ key: lasagna.key, title: 'Lasagna, Our Way' }])).toEqual([lasagna.key]);
    // A group known only by its title is a new group once renamed.
    expect(canonicalCollapsedKeys(['recipe-title:kelaguen'], [{ key: 'recipe-title:chicken kelaguen', title: 'Chicken Kelaguen' }])).toEqual([]);
    expect(isSectionCollapsed(['Adobo'], adobo)).toBe(false);
  });

  it('toggles one section by its key', () => {
    const folded = toggleSectionCollapsed({ keys: [], updatedAt: 0 }, lasagna, 100);
    expect(folded).toEqual({ keys: [lasagna.key], updatedAt: 100 });
    expect(toggleSectionCollapsed(folded, lasagna, 200)).toEqual({ keys: [], updatedAt: 200 });
  });

  it('expands everything, including groups the current view hides', () => {
    expect(expandAllSections(9)).toEqual({ keys: [], updatedAt: 9 });
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

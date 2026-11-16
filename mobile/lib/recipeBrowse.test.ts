import { describe, expect, it } from 'vitest';
import { discoverSections, recipeMinutes } from './recipeBrowse';
import type { RecipeListItem } from '@/types/recipe';
const recipe = (id: string, total_time: string | null, created_at = '2026-10-31T10:00:00Z') => ({ id, total_time, created_at }) as RecipeListItem;
describe('Discover browse sections', () => {
  it.each([['25 min', 25], ['1 hour 15 minutes', 75], ['0.25 hours', 15], ['30 mins', 30], ['1h', 60], ['15–20 min', null], ['about 20 min', null], [null, null], ['', null], ['0 min', null]] as const)('classifies duration %s conservatively', (time, expected) => expect(recipeMinutes(time)).toBe(expected));
  it('shows only a strictly-under-30-minute Quick section without hiding the main feed or a duplicate new-this-week section', () => {
    const recipes = [recipe('quick', '25 min'), recipe('boundary', '30 min'), recipe('old', '10 min', '2026-09-01'), recipe('future', '1 hour', '2027-01-01'), recipe('unknown', '15–20 min', 'bad-date')];
    const sections = discoverSections(recipes);
    expect(sections.map(section => [section.title, section.recipes.map(r => r.id)])).toEqual([
      ['Quick (under 30 min)', ['quick', 'old']],
    ]);
    expect(recipes).toHaveLength(5);
  });
  it('omits empty curated sections and limits each to four cards', () => {
    expect(discoverSections([])).toEqual([]);
    expect(discoverSections(Array.from({ length: 8 }, (_, i) => recipe(String(i), '20 min'))).map(s => s.recipes.length)).toEqual([4]);
  });
});

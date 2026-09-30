import { describe, expect, it } from 'vitest';
import { pantryDateForEntry, pantryDateFromEntry, pantryDateStatus, pantrySearchNames, parsePantryNames } from './pantry';
import type { PantryItem } from '@/types/pantry';

const item = (id: string, name: string, quantity: string | null, date_value: string | null): PantryItem => ({
  id, name, quantity, date_value, date_kind: date_value ? 'use_by' : null,
  unit: null, location: null, notes: null, created_at: '', updated_at: '',
});

describe('pantry helpers', () => {
  it('accepts pasted names and keeps one of each spelling', () => {
    expect(parsePantryNames(' Rice, eggs\nrice\nTomatoes, ')).toEqual(['Rice', 'eggs', 'Tomatoes']);
  });

  it('excludes past-date and empty lots from recipe search', () => {
    const items = [
      item('1', 'Rice', '2', null),
      item('2', 'rice', '1', null),
      item('3', 'Milk', null, '2026-09-28'),
      item('4', 'Eggs', '0', null),
      item('5', 'Tomatoes', null, '2026-09-30'),
    ];
    expect(pantrySearchNames(items, '2026-09-29')).toEqual(['rice', 'tomatoes']);
    expect(pantryDateStatus(items[2], '2026-09-29')).toBe('expired');
    expect(pantryDateStatus(items[4], '2026-09-29')).toBe('soon');
  });

  it('accepts a familiar date while rejecting impossible calendar days', () => {
    expect(pantryDateFromEntry('9/30/2026')).toBe('2026-09-30');
    expect(pantryDateForEntry('2026-09-30')).toBe('09/30/2026');
    expect(pantryDateFromEntry('2/30/2026')).toBeNull();
  });
});

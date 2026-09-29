import type { PantryItem } from '@/types/pantry';

/** Bulk entry keeps the first spelling while removing duplicates in the paste. */
export function parsePantryNames(input: string): string[] {
  const seen = new Set<string>();
  return input.split(/[,\n]+/).map((name) => name.trim()).filter((name) => {
    const key = name.toLocaleLowerCase('en');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function pantryDateStatus(item: PantryItem, today: string): 'expired' | 'soon' | 'ok' {
  if (!item.date_value) return 'ok';
  if (item.date_value < today) return 'expired';
  const end = new Date(`${today}T12:00:00`);
  end.setDate(end.getDate() + 3);
  const soon = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return item.date_value <= soon ? 'soon' : 'ok';
}

export function pantrySearchNames(items: PantryItem[], today: string): string[] {
  return [...new Set(items
    .filter((item) => pantryDateStatus(item, today) !== 'expired')
    .filter((item) => item.quantity === null || Number(item.quantity) > 0)
    .map((item) => item.name.trim().toLocaleLowerCase('en'))
    .filter(Boolean))];
}

export function pantryDateForEntry(isoDate: string | null): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year}`;
}

export function pantryDateFromEntry(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Display-only cooking amounts. Never use the glyph form to rewrite source data. */
const fractions = [
  [1 / 8, '⅛', '1/8'], [1 / 4, '¼', '1/4'], [1 / 3, '⅓', '1/3'],
  [3 / 8, '⅜', '3/8'], [1 / 2, '½', '1/2'], [5 / 8, '⅝', '5/8'],
  [2 / 3, '⅔', '2/3'], [3 / 4, '¾', '3/4'], [7 / 8, '⅞', '7/8'],
] as const;
const metric = /^(?:g|kg|ml|l|grams?|kilograms?|millilit(?:er|re)s?|lit(?:er|re)s?)\.?$/i;

export function parseQuantity(quantity: string): number | null {
  const input = quantity.trim();
  const slash = input.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  const unicode = input.match(/^(\d+)?\s*([⅛¼⅓⅜½⅝⅔¾⅞])$/);
  const value = slash && Number(slash[3]) > 0
    ? Number(slash[1] || 0) + Number(slash[2]) / Number(slash[3])
    : unicode ? Number(unicode[1] || 0) + fractions.find(f => f[1] === unicode[2])![0]
      : /^\d+(?:\.\d+)?$/.test(input) ? Number(input) : NaN;
  return Number.isFinite(value) ? value : null;
}

export function formatQuantity(quantity: string | null | undefined, unit?: string | null): string | null {
  if (quantity == null) return null;
  const value = parseQuantity(quantity);
  if (value === null) return quantity; // Ranges, qualitative amounts and ambiguous imports.
  if (metric.test(unit?.trim() ?? '')) return String(Number(value < 0.001 && value > 0 ? value.toPrecision(3) : value.toFixed(3)));
  const integer = Math.round(value);
  if (integer > 0 && Math.abs(value - integer) <= 0.02 + 1e-9) return String(integer);
  const whole = Math.floor(value);
  const fraction = [...fractions].sort((a, b) => Math.abs(value - whole - a[0]) - Math.abs(value - whole - b[0]))[0];
  if (Math.abs(value - whole - fraction[0]) <= 0.02 + 1e-9) return `${whole || ''}${fraction[1]}`;
  return String(Number(value > 0 && value < 0.1 ? value.toPrecision(2) : value.toFixed(value >= 10 ? 0 : 1)));
}

/** Also handles fractions inside ingredient names/notes without losing surrounding text. */
export function spokenQuantity(text: string): string {
  return text.replace(/(\d+)?([⅛¼⅓⅜½⅝⅔¾⅞])/g, (_, whole, glyph) =>
    `${whole ? `${whole} and ` : ''}${fractions.find(f => f[1] === glyph)![2]}`);
}

export function formatIngredientAmount(quantity: string | null | undefined, unit?: string | null): string {
  return [formatQuantity(quantity, unit), unit].filter(Boolean).join(' ');
}

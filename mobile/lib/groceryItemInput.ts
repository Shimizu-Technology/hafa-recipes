/**
 * Quick entry for the grocery list: "2 lb chicken thighs" becomes a quantity,
 * a unit and a name, so the row reads like a recipe item and the edit sheet
 * opens with each part in its own field. Anything that doesn't start with an
 * amount stays exactly as typed.
 */
import type { GroceryItemCreate } from '@/types/recipe';

// Units people type for shopping. Plurals and a trailing period are accepted.
const UNITS = [
  'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces', 'g', 'gram', 'grams', 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'ml', 'l', 'liter', 'liters', 'litre', 'litres', 'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
  'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons', 'can', 'cans', 'jar', 'jars', 'bottle', 'bottles', 'bag', 'bags',
  'box', 'boxes', 'pack', 'packs', 'package', 'packages', 'bunch', 'bunches', 'head', 'heads', 'clove', 'cloves',
  'loaf', 'loaves', 'stick', 'sticks', 'dozen', 'piece', 'pieces', 'slice', 'slices',
];
const AMOUNT = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d*\s?[⅛¼⅓⅜½⅝⅔¾⅞]|\d+(?:\.\d+)?`;
const UNIT = String.raw`(?:${UNITS.join('|')})\.?`;
// An amount, then a unit (spaced or attached, as in "2lb"), then the name.
const WITH_UNIT = new RegExp(String.raw`^(${AMOUNT})\s*(${UNIT})\s+(?:of\s+)?(.+)$`, 'i');
// An amount on its own needs a space before the name, so "7up" stays a name.
const COUNT_ONLY = new RegExp(String.raw`^(${AMOUNT})\s+(.+)$`, 'i');

// The API's limit for a quantity; a longer "amount" is kept as part of the name.
const MAX_QUANTITY_LENGTH = 50;

export function parseGroceryItemInput(input: string): Pick<GroceryItemCreate, 'name' | 'quantity' | 'unit'> {
  const text = input.trim().replace(/\s+/g, ' ');
  const whole = { name: text, quantity: null, unit: null };
  const withUnit = text.match(WITH_UNIT);
  if (withUnit) return withUnit[1].length > MAX_QUANTITY_LENGTH ? whole : { name: withUnit[3], quantity: withUnit[1], unit: withUnit[2].replace(/\.$/, '') };
  const countOnly = text.match(COUNT_ONLY);
  // "2 lb" alone has no name to split off.
  if (countOnly && countOnly[1].length <= MAX_QUANTITY_LENGTH && !new RegExp(`^${UNIT}$`, 'i').test(countOnly[2])) return { name: countOnly[2], quantity: countOnly[1], unit: null };
  return whole;
}

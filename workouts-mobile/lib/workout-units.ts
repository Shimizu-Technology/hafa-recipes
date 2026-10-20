import type { UnitSystem } from "./training";

const metresPerMile = 1609.344;

/** The distance unit the workout editor shows for the person's units setting. */
export const distanceUnit = (units: UnitSystem) => (units === "imperial" ? "miles" : "metres");

/** Stored metres as editor text: miles to two decimals for imperial, metres as saved for metric. */
export function distanceText(meters: number, units: UnitSystem) {
  return units === "imperial" ? String(Number((meters / metresPerMile).toFixed(2))) : String(meters);
}

/** Typed editor text as metres to save. Blank is null; invalid text stays NaN so validation can name it. */
export function typedDistance(text: string, units: UnitSystem) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(",", "."));
  return units === "imperial" ? Math.round(value * metresPerMile * 100) / 100 : value;
}

/** The weight unit a new load starts with. */
export const defaultLoadUnit = (units: UnitSystem) => (units === "imperial" ? "lb" : "kg");

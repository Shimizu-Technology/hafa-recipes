import type { UnitSystem } from "./training";

const metresPerMile = 1609.344;

/** The distance unit the workout editor shows for the person's units setting. */
export const distanceUnit = (units: UnitSystem) => (units === "imperial" ? "miles" : "metres");

/**
 * Stored metres as editor text. Imperial shows miles: two decimals from a mile up, three significant
 * digits below it, so short gym distances (20 m ≈ 0.0124 mi) never read as zero. Metric shows metres as saved.
 */
export function distanceText(meters: number, units: UnitSystem) {
  if (units !== "imperial") return String(meters);
  const miles = meters / metresPerMile;
  return String(Number(miles >= 1 ? miles.toFixed(2) : miles.toPrecision(3)));
}

/** Typed editor text as metres to save; typed miles round to whole metres. Blank is null; invalid text stays NaN so validation can name it. */
export function typedDistance(text: string, units: UnitSystem) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(",", "."));
  return units === "imperial" ? Math.round(value * metresPerMile) : value;
}

/** The weight unit a new load starts with. */
export const defaultLoadUnit = (units: UnitSystem) => (units === "imperial" ? "lb" : "kg");

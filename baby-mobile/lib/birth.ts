import type { Child, ChildDetails } from "./models";

/** The birth date and, when she knows it, the time, on her profile's clock: a baby born at 11:40 PM is born that day. */
export function birthParts(iso: string, timeZone: string | null | undefined, timeKnown: boolean) {
  const at = new Date(iso), zone = timeZone || undefined;
  const parts = (options: Intl.DateTimeFormatOptions, locale: string) => {
    try { return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).formatToParts(at); }
    catch { return new Intl.DateTimeFormat(locale, options).formatToParts(at); }
  };
  const day = parts({ year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA"), get = (list: Intl.DateTimeFormatPart[], type: string) => list.find((p) => p.type === type)?.value ?? "";
  const clock = parts({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "en-GB");
  return { birth_date: `${get(day, "year")}-${get(day, "month")}-${get(day, "day")}`, birth_time: timeKnown ? `${get(clock, "hour")}:${get(clock, "minute")}` : null };
}

const gramsPerOunce = 28.349523125;
/** Pounds and ounces as she'd say them. Blank is no weight; anything else out of range is a problem to show. */
export function gramsFrom(lb: string, oz: string): number | null | "invalid" {
  const pounds = lb.trim(), ounces = oz.trim().replace(",", ".");
  if (!pounds && !ounces) return null;
  if ((pounds && !/^\d{1,2}$/.test(pounds)) || (ounces && !/^\d{1,2}(\.\d)?$/.test(ounces))) return "invalid";
  const total = Number(pounds || 0) * 16 + Number(ounces || 0);
  if (Number(ounces || 0) >= 16) return "invalid";
  const grams = Math.round(total * gramsPerOunce);
  return grams >= 100 && grams <= 10000 ? grams : "invalid";
}

/** What the birth flow sends with the date: only what she gave, so an answer already there isn't cleared. */
export function birthWrite(child: Child, name: string, birthTime: string | null, grams: number | null) {
  const details: Pick<ChildDetails, "birth_time" | "weight_at_birth_g"> = {};
  if (birthTime) details.birth_time = birthTime;
  if (grams !== null) details.weight_at_birth_g = grams;
  const trimmed = name.trim();
  return { ...(trimmed && trimmed !== child.name ? { name: trimmed.slice(0, 120) } : {}), ...(Object.keys(details).length ? { details } : {}) };
}

export const welcome = (name: string) => name.trim() ? `Welcome, ${name.trim()}.` : "Welcome, little one.";

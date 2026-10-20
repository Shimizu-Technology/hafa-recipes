/** Plan sessions grouped into Monday–Sunday weeks so a long plan reads week by week. */
export interface PlanWeek<T> {
  /** Monday of the week (YYYY-MM-DD), or "other" for dates that can't be read. */
  key: string;
  /** "This week · Oct 20 – 26" or "Week 2 · Oct 27 – Nov 2". */
  label: string;
  past: boolean;
  current: boolean;
  items: T[];
}
const DAY = 86_400_000;
const readable = (iso: string) => {
  const at = new Date(`${iso}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === iso ? at : null;
};
const mondayOf = (at: Date) => new Date(at.getTime() - ((at.getUTCDay() + 6) % 7) * DAY);

/** "Oct 20 – 26", "Oct 27 – Nov 2", with the year added when it isn't the current one. */
export function weekRange(monday: string, now = new Date(), locale?: string) {
  const start = readable(monday);
  if (!start) return monday;
  const end = new Date(start.getTime() + 6 * DAY);
  const year = end.getUTCFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {};
  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const tail = start.getUTCMonth() === end.getUTCMonth() && !("year" in year) ? String(end.getUTCDate())
    : new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC", ...year }).format(end);
  return `${day.format(start)} – ${tail}`;
}

/** Groups items by week in date order. Week numbers count from the plan's first week. */
export function groupPlanWeeks<T extends { date: string }>(items: T[], today: string, now = new Date(), locale?: string): PlanWeek<T>[] {
  const todayAt = readable(today);
  const thisMonday = todayAt ? mondayOf(todayAt).toISOString().slice(0, 10) : today;
  const weeks = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    const at = readable(item.date);
    const key = at ? mondayOf(at).toISOString().slice(0, 10) : "other";
    weeks.set(key, [...(weeks.get(key) ?? []), item]);
  }
  const first = [...weeks.keys()].find((key) => key !== "other");
  const firstAt = first ? readable(first)!.getTime() : 0;
  return [...weeks.entries()].map(([key, grouped]) => {
    if (key === "other") return { key, label: "Other dates", past: false, current: false, items: grouped };
    const current = key === thisMonday;
    const number = Math.round((readable(key)!.getTime() - firstAt) / (7 * DAY)) + 1;
    return { key, label: `${current ? "This week" : `Week ${number}`} · ${weekRange(key, now, locale)}`,
      past: key < thisMonday, current, items: grouped };
  });
}

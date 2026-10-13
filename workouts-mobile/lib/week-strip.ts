/**
 * This week (Monday–Sunday) around `today` (YYYY-MM-DD in the profile timezone),
 * marking days with recorded training and planned sessions. Display-only: no
 * streaks, no judgement about missed days.
 */
export type WeekDayState = "done" | "planned" | "today" | "rest";
export interface WeekDay {
  date: string;
  label: string;
  state: WeekDayState;
  accessibilityLabel: string;
}
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export function weekDays(today: string, done: ReadonlySet<string>, planned: ReadonlySet<string>, locale?: string): WeekDay[] {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = shift(today, -weekday);
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => {
    const date = shift(monday, i);
    const at = new Date(`${date}T12:00:00Z`);
    const state: WeekDayState = done.has(date) ? "done" : date === today ? "today" : planned.has(date) ? "planned" : "rest";
    const detail = done.has(date)
      ? "training recorded"
      : planned.has(date)
        ? date === today
          ? "today, session planned"
          : "session planned"
        : date === today
          ? "today"
          : "no session";
    return { date, label: narrow.format(at), state, accessibilityLabel: `${long.format(at)}, ${detail}` };
  });
}

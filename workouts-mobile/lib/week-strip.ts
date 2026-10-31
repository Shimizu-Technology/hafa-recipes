/**
 * This week (Monday–Sunday) around `today` (YYYY-MM-DD in the profile timezone),
 * marking days with recorded training and planned sessions. Display-only: no
 * streaks, no judgement about missed days.
 */
export type WeekDayState = "done" | "planned" | "today" | "rest";
export interface WeekDay {
  date: string;
  today?: boolean;
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
    return { date, today: date === today, label: narrow.format(at), state, accessibilityLabel: `${long.format(at)}, ${detail}` };
  });
}

/** Counts only recorded work from the already reconciled session selection. */
export function weekSummary(today: string, sessions: Array<{ started_at: string; finished_at: string; active_seconds?: number; actuals: Array<{ completed: boolean }> }>, timezone: string) {
  const day = (iso: string) => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  };
  const recorded = sessions.filter(s => s.actuals.some(a => a.completed));
  const monday = weekDays(today, new Set(), new Set())[0].date;
  const current = recorded.filter(s => day(s.started_at) >= monday && day(s.started_at) <= today);
  const dates = new Set(recorded.map(s => day(s.started_at)));
  let cursor = dates.has(today) ? today : shift(today, -1), streak = 0;
  while (dates.has(cursor)) { streak++; cursor = shift(cursor, -1); }
  const seconds = current.reduce((n, s) => n + Math.max(0, s.active_seconds ?? 0), 0);
  return { sessions: current.length, minutes: Math.round(seconds / 60), streak };
}

/** A date for a sentence, in this phone's own calendar. */
export function friendlyDay(iso: string, addDays = 0) {
  const date = new Date(iso);
  date.setDate(date.getDate() + addDays);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

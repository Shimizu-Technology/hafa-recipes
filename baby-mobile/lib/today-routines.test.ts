import { expect, it } from "vitest";
import { optimisticRecord } from "./models";
import { routineToday, routineReminderLabel } from "./today-routines";
const now = new Date("2026-10-30T16:00:00Z"); // Oct 31 on Guam
const row = optimisticRecord({ id: "routine", kind: "routine", title: "Bag", body: "", child_id: null,
  occurred_at: now.toISOString(), data: { enabled: true, reminder_at: "2026-10-31T00:00:00+10:00", timezone: "Pacific/Guam" } });
it("includes only today's chosen reminders in their own timezone", () => {
  expect(routineToday(row, now)).toBe(true);
  expect(routineToday({ ...row, data: { ...row.data, enabled: false } }, now)).toBe(false);
  expect(routineToday({ ...row, data: { ...row.data, reminder_at: "2026-11-01T00:00:00+10:00" } }, now)).toBe(false);
  expect(routineToday({ ...row, data: { ...row.data, reminder_at: "2026-10-30T00:00:00+10:00" } }, now)).toBe(false);
});
it("includes daily/weekly reminders after their start and unfinished undated lists", () => {
  const data = { ...row.data, reminder_at: "2026-10-24T10:00:00+10:00", repeat: "weekly" as const };
  expect(routineToday({ ...row, data }, now)).toBe(true);
  expect(routineToday({ ...row, data: { ...data, reminder_at: "2026-10-23T10:00:00+10:00" } }, now)).toBe(false);
  expect(routineToday({ ...row, data: { ...data, repeat: "daily" } }, now)).toBe(true);
  expect(routineToday({ ...row, data: { items: [{ id: "one", label: "Pack", done: false }] } }, now)).toBe(true);
  expect(routineToday({ ...row, data: { ...data, items: [{ id: "one", label: "Pack", done: true }] } }, now)).toBe(false);
});

it("labels a daily reminder by its chosen local clock rather than its original date", () => {
  const daily = { ...row, data: { ...row.data, reminder_at: "2026-10-20T23:00:00Z", repeat: "daily" as const } };
  expect(routineToday(daily, now)).toBe(true);
  expect(routineReminderLabel(daily)).toBe("Daily · 9:00 AM");
});
it("labels a weekly reminder with its local weekday and clock rather than its original date", () => {
  const weekly = { ...row, data: { ...row.data, reminder_at: "2026-10-23T23:00:00Z", repeat: "weekly" as const } };
  expect(routineToday(weekly, now)).toBe(true);
  expect(routineReminderLabel(weekly)).toBe("Weekly · Sat 9:00 AM");
});

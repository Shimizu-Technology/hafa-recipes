import { expect, it } from "vitest";
import { toISODate, todayISODate } from "./calendar-date";

it("stores a picked day as the same YYYY-MM-DD the typed field used", () => {
  expect(toISODate(new Date(2026, 10, 17, 12))).toBe("2026-11-17");
  expect(toISODate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
});
it("defaults to today, or the earliest allowed day when that is later", () => {
  const now = new Date(2026, 10, 17, 9);
  expect(todayISODate(undefined, now)).toBe("2026-11-17");
  expect(todayISODate("2026-11-01", now)).toBe("2026-11-17");
  expect(todayISODate("2026-12-01", now)).toBe("2026-12-01");
  expect(todayISODate("not a date", now)).toBe("2026-11-17");
});

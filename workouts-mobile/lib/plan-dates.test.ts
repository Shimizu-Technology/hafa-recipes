import { expect, it } from "vitest";
import { addDays, daysBetween, nextOffset, offsetFor, sessionDate } from "./plan-dates";

it("moves across months, years and leap days", () => {
  expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  expect(addDays("2026-02-30", 1)).toBe("2026-02-30");
});

it("turns a chosen date into the offset the server expects and back", () => {
  expect(daysBetween("2026-10-21", "2026-10-28")).toBe(7);
  expect(offsetFor("2026-10-21", "2026-10-21")).toBe("0");
  expect(offsetFor("2026-10-21", "2026-10-20")).toBe("-1");
  expect(offsetFor("2026-10-21", null)).toBe("");
  expect(sessionDate("2026-10-21", "2")).toBe("2026-10-23");
  expect(sessionDate("2026-10-21", "")).toBeNull();
});

it("puts a new session the day after the latest one", () => {
  expect(nextOffset([])).toBe("0");
  expect(nextOffset(["0", "2", ""])).toBe("3");
  expect(nextOffset(["365"])).toBe("365");
});

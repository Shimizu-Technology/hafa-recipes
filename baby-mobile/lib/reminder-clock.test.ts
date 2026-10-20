import { expect, it } from "vitest";
import { reminderClock } from "./reminder-clock";
it("keeps a Guam morning schedule on the correct calendar day when the device travels", () => {
  expect(reminderClock(new Date("2026-10-20T23:30:00Z"), "Pacific/Guam")).toEqual({ hour: 9, minute: 30, weekday: 4 });
});
it("uses the chosen zone across daylight saving transitions", () => {
  expect(reminderClock(new Date("2026-11-01T08:30:00Z"), "America/Los_Angeles")).toEqual({ hour: 1, minute: 30, weekday: 1 });
  expect(reminderClock(new Date("2026-11-01T09:30:00Z"), "America/Los_Angeles")).toEqual({ hour: 1, minute: 30, weekday: 1 });
});

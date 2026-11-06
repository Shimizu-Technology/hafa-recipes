import { describe, expect, it, vi } from "vitest";
vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
import { readFileSync } from "node:fs";
import { addToPhoneCalendar, phoneCalendarAvailable, phoneEvent, phoneEventLine } from "./phone-calendar";
import { optimisticRecord, type BabyRecord, type EventOccurrence, type RecordData } from "./models";
import { occurrenceAt } from "./events";

const guam = "Pacific/Guam";
const row = (data: RecordData, occurred_at = "2026-11-16T00:00:00.000Z", extra: Partial<BabyRecord> = {}) =>
  ({ ...optimisticRecord({ id: "e", kind: "event", title: "OB visit", body: "Ask about the rash", child_id: "baby", occurred_at, data: { timezone: guam, attendees: ["Grandma"], reminder_minutes: [60], location: "Clinic", category: "appointment", ...data } }), ...extra });
const shown = (record: BabyRecord, at?: string): EventOccurrence => occurrenceAt(record, at);
const localDay = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];

describe("what's copied to the phone's calendar", () => {
  it("is the title, the time and the place, and nothing else she wrote", () => {
    const event = phoneEvent(row({ end: "2026-11-16T00:30:00.000Z" }), shown(row({ end: "2026-11-16T00:30:00.000Z" })));
    expect(Object.keys(event).sort()).toEqual(["allDay", "endDate", "location", "startDate", "timeZone", "title"]);
    expect(event).toMatchObject({ title: "OB visit", location: "Clinic", allDay: false, timeZone: guam });
    expect(event.startDate.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(event.endDate.toISOString()).toBe("2026-11-16T00:30:00.000Z");
    const text = JSON.stringify(event);
    for (const secret of ["rash", "Grandma", "appointment", "baby"]) expect(text).not.toContain(secret);
  });
  it("gives a time with no end an hour, which she can change in the sheet", () => {
    const event = phoneEvent(row({}), shown(row({})));
    expect(event.endDate.getTime() - event.startDate.getTime()).toBe(3_600_000);
  });
  it("leaves the place out when there's none", () => {
    expect(phoneEvent(row({ location: null }), shown(row({ location: null })))).not.toHaveProperty("location");
  });
  it("keeps an all-day event on its own calendar date, wherever the phone is", () => {
    const record = row({ all_day: true }, "2026-11-19T14:00:00.000Z"), event = phoneEvent(record, shown(record));
    expect(event.allDay).toBe(true);
    expect(event).not.toHaveProperty("timeZone");
    expect(localDay(event.startDate)).toEqual([2026, 11, 20]);
    expect(localDay(event.endDate)).toEqual([2026, 11, 20]);
  });
  it("ends a long all-day event on its last day, not the midnight after", () => {
    const record = row({ all_day: true, end: "2026-11-21T14:00:00.000Z" }, "2026-11-19T14:00:00.000Z"), event = phoneEvent(record, shown(record));
    expect(localDay(event.endDate)).toEqual([2026, 11, 21]);
  });
});
describe("a repeating event", () => {
  const weekly = (extra: RecordData = {}) => row({ recurrence: { frequency: "weekly", interval: 2, until: "2027-03-01" }, ...extra }, "2026-11-02T00:00:00.000Z");
  it("carries its rule, from the date she has open", () => {
    const record = weekly(), event = phoneEvent(record, shown(record, "2026-11-16T00:00:00.000Z"));
    expect(event.startDate.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(event.recurrenceRule).toMatchObject({ frequency: "weekly", interval: 2 });
    expect(event.recurrenceRule!.endDate!.toISOString()).toBe("2027-03-01T13:59:00.000Z");
  });
  it("ends on the last day on the event's own calendar, wherever the phone is", () => {
    // Guam is ahead of a phone in Los Angeles, and Los Angeles is behind one on Guam. Each last day is the event's own.
    const guamRepeat = row({ recurrence: { frequency: "daily", until: "2026-11-30" } }, "2026-11-20T23:00:00.000Z"),
      laRepeat = row({ timezone: "America/Los_Angeles", recurrence: { frequency: "daily", until: "2026-11-30" } }, "2026-11-20T17:00:00.000Z");
    const guamEnd = phoneEvent(guamRepeat, shown(guamRepeat)).recurrenceRule!.endDate!, laEnd = phoneEvent(laRepeat, shown(laRepeat)).recurrenceRule!.endDate!;
    expect(guamEnd.toISOString()).toBe("2026-11-30T13:59:00.000Z");
    expect(laEnd.toISOString()).toBe("2026-12-01T07:59:00.000Z");
    // The Dec 1 showing, 9 AM on Guam, can't start before that end.
    expect(guamEnd.getTime()).toBeLessThan(new Date("2026-11-30T23:00:00.000Z").getTime());
  });
  it("ends an all-day repeat on the phone's own date, as an all-day event is a date there", () => {
    const record = row({ all_day: true, recurrence: { frequency: "yearly", until: "2030-11-20" } }, "2026-11-19T14:00:00.000Z");
    expect(localDay(phoneEvent(record, shown(record)).recurrenceRule!.endDate!)).toEqual([2030, 11, 20]);
  });
  it("with no last day has none on the phone", () => {
    const record = row({ recurrence: { frequency: "yearly" } }, "2026-11-02T00:00:00.000Z");
    expect(phoneEvent(record, shown(record)).recurrenceRule).toEqual({ frequency: "yearly", interval: 1 });
  });
  it("says which dates go", () => {
    const record = weekly();
    expect(phoneEventLine(record, shown(record, "2026-11-16T00:00:00.000Z"), "2026-11-04")).toMatch(/^Every 2 weeks from Mon, Nov 16\./);
  });
  it("a date changed on its own goes alone, as it's changed", () => {
    const at = "2026-11-16T00:00:00.000Z", record = weekly({ exceptions: [{ original_start: at, cancelled: false, overrides: { title: "Moved visit" } }] }), one = shown(record, at);
    const event = phoneEvent(record, one);
    expect(event.title).toBe("Moved visit");
    expect(event).not.toHaveProperty("recurrenceRule");
    expect(phoneEventLine(record, one, "2026-11-04")).toMatch(/^Only Mon, Nov 16/);
  });
  it("says single-date changes stay here", () => {
    const record = weekly({ exceptions: [{ original_start: "2026-11-30T00:00:00.000Z", cancelled: true, overrides: null }] });
    expect(phoneEventLine(record, shown(record, "2026-11-16T00:00:00.000Z"), "2026-11-04")).toContain("Changes to single dates stay in Håfa");
  });
  it("warns that a phone can skip short months", () => {
    const record = row({ recurrence: { frequency: "monthly" } }, "2026-10-31T00:00:00.000Z");
    expect(phoneEventLine(record, shown(record), "2026-10-01")).toContain("skip months");
  });
  it("doesn't warn about a date that always comes round", () => {
    const yearly = row({ recurrence: { frequency: "yearly" } }, "2026-11-29T14:00:00.000Z"), early = row({ recurrence: { frequency: "monthly" } }, "2026-11-01T00:00:00.000Z");
    expect(phoneEventLine(yearly, shown(yearly), "2026-11-04")).not.toContain("skip");
    expect(phoneEventLine(early, shown(early), "2026-11-01")).not.toContain("skip");
  });
  it("warns about a leap day", () => {
    const leap = row({ recurrence: { frequency: "yearly" } }, "2028-02-29T00:00:00.000Z");
    expect(phoneEventLine(leap, shown(leap), "2028-02-01")).toContain("skip years");
  });
});
describe("a one-off", () => {
  it("says only what goes", () => {
    expect(phoneEventLine(row({}), shown(row({})), "2026-11-04")).toBe("Only the title, time and place are copied.");
  });
});
describe("the sheet", () => {
  it("isn't offered on a binary without the module, and says so if it's called anyway", async () => {
    expect(phoneCalendarAvailable()).toBe(false);
    await expect(addToPhoneCalendar({ title: "x", startDate: new Date(), endDate: new Date(), allDay: false })).resolves.toBe("unavailable");
  });
});
describe("what the app asks the phone for", () => {
  const config = readFileSync(new URL("../app.config.ts", import.meta.url), "utf8");
  it("never asks for calendar access, and has the words Apple requires because the module could", () => {
    expect(config).toMatch(/writeOnlyAccess: true/);
    for (const key of ["calendarPermission", "writeOnlyCalendarPermission", "remindersPermission"]) expect(config).toMatch(new RegExp(`${key}: "`));
    const source = readFileSync(new URL("./phone-calendar.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/requestCalendarPermissions|getCalendars|getEvents|createEventAsync/);
    // A real phone refused this: production Metro makes import() a chunk to fetch.
    expect(source).not.toMatch(/await import\(/);
  });
  it("blocks Android's calendar permissions, which the module's plugin would add by itself", () => {
    expect(config).toContain("android.permission.READ_CALENDAR");
    expect(config).toContain("android.permission.WRITE_CALENDAR");
    expect(config).toMatch(/blockedPermissions/);
  });
});

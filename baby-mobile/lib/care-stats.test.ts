import { describe, expect, it } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { basedOn, customProblem, statsNote, waitingEntries } from "./care-stats";
import { answer, day } from "./care-stats-fixtures";

const guam = "Pacific/Guam", now = new Date("2026-11-04T10:00:00Z"); // 8 PM on Nov 4 in Guam.
const row = (id: string, kind: BabyRecord["kind"], occurred_at: string, data: BabyRecord["data"] = {}) => optimisticRecord({ id, kind, title: "", body: "", child_id: "baby", occurred_at, data });
const save = (record: BabyRecord): Mutation => ({ id: `m${record.id}`, generation: 1, type: "save", files: [], record });
const state = (outbox: Mutation[], records: BabyRecord[] = []): DeviceState => ({ ...emptyState(), outbox, records });

describe("what the app says about dates and days", () => {
  it("counts logged days out of finished ones, in her words", () => {
    expect(basedOn(6, 7)).toBe("based on 6 logged days of 7");
    expect(basedOn(1, 7)).toBe("based on 1 logged day of 7");
  });
  it("stops dates the API would refuse, in the API's own words", () => {
    expect(customProblem("2026-11-02", "2026-11-01", "2026-11-04")).toBe("Choose a start before the end");
    expect(customProblem("2026-11-05", "2026-11-06", "2026-11-04")).toBe("Choose dates that have already started");
    expect(customProblem("2026-01-01", "2026-11-01", "2026-11-04")).toBe("Choose 92 days or fewer");
    expect(customProblem("2026-08-04", "2026-11-03", "2026-11-04")).toBeNull();
    expect(customProblem("2026-08-03", "2026-11-03", "2026-11-04")).toBe("Choose 92 days or fewer");
  });
});

describe("which queued changes could move these numbers", () => {
  const week = () => answer([day("2026-11-01"), day("2026-11-02"), day("2026-11-03"), day("2026-11-04", true)]);
  const rolling = () => answer([day("2026-11-03", true), day("2026-11-04", true)], "24h");
  const waiting = (stats: ReturnType<typeof answer>, outbox: Mutation[], records: BabyRecord[] = []) => waitingEntries(state(outbox, records), "baby", stats, guam);
  const range = () => { const stats = week(); stats.range.start = "2026-10-31T14:00:00.000Z"; return stats; }; // Midnight on Nov 1 in Guam.
  it("counts nothing when nothing is queued", () => {
    expect(waiting(week(), [])).toBe(0);
  });
  it("counts an entry once however many changes it has, and each kind Stats adds up", () => {
    const feed = row("f", "feeding", "2026-11-03T02:00:00Z");
    expect(waiting(range(), [save(feed), { ...save(feed), id: "again" }, save(row("k", "kick_session", "2026-11-03T03:00:00Z"))])).toBe(2);
  });
  it("leaves out what isn't in these days, this baby's, or added up here", () => {
    expect(waiting(range(), [save(row("before", "feeding", "2026-10-30T02:00:00Z"))])).toBe(0);
    expect(waiting(range(), [save(row("after", "feeding", "2026-11-05T02:00:00Z"))])).toBe(0);
    expect(waiting(range(), [save({ ...row("sister", "feeding", "2026-11-03T02:00:00Z"), child_id: "sister" })])).toBe(0);
    expect(waiting(range(), [save(row("q", "question", "2026-11-03T02:00:00Z"))])).toBe(0);
  });
  it("counts an entry being moved out of these days and one being deleted, since both change them", () => {
    const held = { ...row("d", "diaper", "2026-11-03T02:00:00Z"), revision: 1 };
    expect(waiting(range(), [save({ ...held, occurred_at: "2026-10-01T02:00:00Z" })], [held])).toBe(1);
    expect(waiting(range(), [{ id: "x", generation: 1, type: "delete", record: held }], [held])).toBe(1);
  });
  it("counts a sleep that runs into the range from before it, and not one that ended before", () => {
    expect(waiting(range(), [save(row("s", "sleep", "2026-10-31T12:00:00Z", { end_at: "2026-10-31T16:00:00Z" }))])).toBe(1);
    expect(waiting(range(), [save(row("t", "sleep", "2026-10-31T10:00:00Z", { end_at: "2026-10-31T12:00:00Z" }))])).toBe(0);
  });
  it("a rolling range counts by its window, not by the days it touches, and takes in what's logged since it was read", () => {
    // The fixture's window opens at 8 PM on Nov 3 in Guam: this is 8 AM that same day.
    expect(waiting(rolling(), [save(row("early", "feeding", "2026-11-02T22:00:00Z"))])).toBe(0);
    expect(waiting(rolling(), [save(row("since", "feeding", "2026-11-04T10:30:00Z"))])).toBe(1);
  });
  it("doesn't count what she chose to keep on this phone, which is never going to sync", () => {
    expect(waiting(range(), [{ ...save(row("f", "feeding", "2026-11-03T02:00:00Z")), localOnly: true }])).toBe(0);
  });
});

describe("the one line under the range", () => {
  const read = new Date("2026-11-04T04:14:00Z"); // 2:14 PM on Nov 4 in Guam.
  it("is nothing at all when the numbers are fresh and nothing is waiting", () => {
    expect(statsNote(read, false, 0, guam, now)).toBeNull();
  });
  it("gives the time of the numbers and how many are waiting, in plain words", () => {
    expect(statsNote(read, false, 3, guam, now)).toMatch(/^Showing numbers from 2:14\sPM\. 3 entries are still waiting to sync\.$/);
    expect(statsNote(read, true, 1, guam, now)).toMatch(/^Showing numbers from 2:14\sPM\. 1 entry is still waiting to sync\.$/);
  });
  it("says only when, if it's just an earlier read", () => {
    expect(statsNote(read, true, 0, guam, now)).toMatch(/^Showing numbers from 2:14\sPM\.$/);
  });
  it("names the day once the numbers are from another one", () => {
    expect(statsNote(new Date("2026-11-03T04:14:00Z"), true, 0, guam, now)).toMatch(/^Showing numbers from Nov 3, 2:14\sPM\.$/);
  });
});

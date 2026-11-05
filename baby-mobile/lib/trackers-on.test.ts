import { describe, expect, it } from "vitest";
import { todayStage, trackerStage } from "./timing";
import { otherStage, trackerById, trackerForKey, trackerOn, trackers, trackersFor, trackingKey } from "./trackers";

const on = (id: string, stage: "expecting" | "born", details?: Parameters<typeof trackerOn>[2]) => trackerOn(trackerById(id)!, stage, details);

describe("which trackers are on", () => {
  it("starts from the stage, as section 16 says", () => {
    expect(trackersFor("born").filter((tracker) => on(tracker.id, "born")).map((tracker) => tracker.id)).toEqual(["breast", "bottle", "diaper", "sleep"]);
    expect(trackersFor("expecting").filter((tracker) => on(tracker.id, "expecting")).map((tracker) => tracker.id)).toEqual(["kicks", "contractions", "feeling", "my_weight", "blood_pressure", "vitamins"]);
  });
  it("lets how she's feeding set breast and bottle, only once the baby's here", () => {
    expect([on("breast", "born", { feeding: "bottle" }), on("bottle", "born", { feeding: "bottle" })]).toEqual([false, true]);
    expect([on("breast", "born", { feeding: "nursing" }), on("bottle", "born", { feeding: "nursing" })]).toEqual([true, false]);
    expect([on("breast", "born", { feeding: "both" }), on("bottle", "born", { feeding: "both" })]).toEqual([true, true]);
    expect([on("breast", "born", { feeding: null }), on("bottle", "born", {})]).toEqual([true, true]);
    expect(on("breast", "expecting", { feeding: "nursing" })).toBe(false);
    expect(on("diaper", "born", { feeding: "bottle" })).toBe(true);
  });
  it("puts what she chose above every default", () => {
    expect(on("diaper", "born", { tracking: { diaper: false } })).toBe(false);
    expect(on("pumping", "born", { tracking: { pumping: true } })).toBe(true);
    expect(on("breast", "born", { feeding: "bottle", tracking: { breast: true } })).toBe(true);
    expect(on("kicks", "born", { tracking: { kicks: true } })).toBe(true);
  });
  it("ignores a key no tracker uses, and details that aren't there", () => {
    expect(on("diaper", "born", { tracking: { something_else: false } })).toBe(true);
    expect(on("diaper", "born", null)).toBe(true);
    expect(on("diaper", "born", { tracking: null })).toBe(true);
  });
  it("gives every tracker a key the API accepts, at both stages, within its limit of 40", () => {
    const keys = [...trackersFor("expecting").map((tracker) => trackingKey(tracker.id, "expecting")), ...trackersFor("born").map((tracker) => trackingKey(tracker.id, "born"))];
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThanOrEqual(38);
    expect(trackers.every((tracker) => trackerForKey(trackingKey(tracker.id, "expecting")) === tracker && trackerForKey(tracker.id) === tracker)).toBe(true);
    expect(trackerForKey("asked_diaper")).toBeUndefined();
  });
  it("lets a switch changed before the birth end at the birth, so the new stage's default stands", () => {
    // Off then back on while she's expecting.
    const before = { tracking: { [trackingKey("kicks", "expecting")]: true, [trackingKey("breast", "expecting")]: false } };
    expect(on("kicks", "expecting", before)).toBe(true);
    expect(on("kicks", "born", before)).toBe(false);
    expect(on("breast", "born", before)).toBe(true);
  });
  it("keeps what she chose after the birth, and goes back to what she chose before it if the birth date's undone", () => {
    const both = { tracking: { kicks: true, [trackingKey("kicks", "expecting")]: false } };
    expect(on("kicks", "born", both)).toBe(true);
    expect(on("kicks", "expecting", both)).toBe(false);
  });
  it("knows which belong to the baby's other stage, and never counts hers", () => {
    const others = (stage: "expecting" | "born") => trackersFor(stage).filter((tracker) => otherStage(tracker, stage)).map((tracker) => tracker.id);
    expect(others("born")).toEqual(["kicks", "contractions"]);
    expect(others("expecting")).toEqual(["breast", "bottle", "diaper", "sleep"]);
  });
});

describe("stages through birth and its reversal", () => {
  const today = new Date(2026, 10, 5), expected = { due_date: "2026-12-10", birth_date: null as string | null },
    details = { tracking: { expecting_kicks: false, expecting_diaper: true, diaper: false } };
  it("birth selects a new set of defaults and undo restores the expecting overrides", () => {
    expect(on("diaper", trackerStage(expected, today), details)).toBe(true);
    expect(on("diaper", trackerStage({ ...expected, birth_date: "2026-11-05" }, today), details)).toBe(false);
    expect(on("diaper", trackerStage(expected, today), details)).toBe(true);
    expect(on("kicks", trackerStage(expected, today), details)).toBe(false);
  });
  it("a stale due date stays expecting until she supplies the birth", () => {
    const overdue = { due_date: "2026-01-01" };
    expect(todayStage(overdue, today)).toBe("needs_birth");
    expect(trackerStage(overdue, today)).toBe("expecting");
  });
  it("no dates has born tracker defaults without claiming a birth", () => {
    expect(todayStage({}, today)).toBe("none");
    expect(trackerStage({}, today)).toBe("born");
  });
});

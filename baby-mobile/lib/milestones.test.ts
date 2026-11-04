import { describe, expect, it } from "vitest";
import { acceptableDay, checkedMilestones, keepsakes, milestoneInstant, milestones, openingAge } from "./milestones";
import type { BabyRecord } from "./models";
import { recordDay } from "./tracker";

const row = (id: string, milestone_id: string, at: string, child_id = "kid"): BabyRecord =>
  ({ id, kind: "milestone", title: milestone_id, body: "", child_id, occurred_at: at, data: { milestone_id }, revision: 1, created_at: at, updated_at: at });

describe("CDC's list as bundled", () => {
  const items = milestones.ages.flatMap((age) => age.domains.flatMap((domain) => domain.items));
  it("has every age the plan names, in order, with four domains and a CDC link each", () => {
    expect(milestones.ages.map((age) => age.months)).toEqual([2, 4, 6, 9, 12, 15, 18, 24, 30, 36, 48, 60]);
    for (const age of milestones.ages) {
      expect(age.domains).toHaveLength(4);
      expect(age.url).toMatch(/^https:\/\/www\.cdc\.gov\/act-early\/milestones\//);
    }
  });
  it("keeps CDC's exact words, spot-checked against the page", () => {
    const words = items.map((item) => item.text);
    expect(items).toHaveLength(159);
    for (const line of ["Calms down when spoken to or picked up", "Seems happy to see you when you walk up to her", "Waves “bye-bye”", "Walks (not climbs) up a few stairs with or without help", "Jumps off the ground with both feet", "Hops on one foot"])
      expect(words).toContain(line);
  });
  it("gives every milestone an id that's unique and fits the API's 80 characters", () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(80);
  });
  it("carries the attribution, the free-availability statement and the non-endorsement line CDC requires", () => {
    expect(milestones.attribution).toContain("Source: CDC");
    expect(milestones.attribution).toContain("available for free on CDC's website");
    expect(milestones.non_endorsement).toContain("does not imply endorsement by CDC, HHS or the United States Government");
    expect(milestones.not_a_screening_tool).toContain("not a substitute for standardized, validated developmental screening tools");
  });
});

describe("which list opens", () => {
  const today = new Date(2027, 2, 10);
  it("opens the first list at or after the child's age, and the last one past 5 years", () => {
    expect(openingAge("2027-03-01", today).id).toBe("2mo");
    expect(openingAge("2027-01-10", today).id).toBe("2mo");
    expect(openingAge("2026-12-11", today).id).toBe("2mo"); // A day short of 3 months.
    expect(openingAge("2026-12-10", today).id).toBe("4mo");
    expect(openingAge("2026-10-10", today).id).toBe("6mo");
    expect(openingAge("2020-01-01", today).id).toBe("5yr");
    expect(openingAge(null, today).id).toBe("2mo");
  });
});

describe("what she has checked", () => {
  it("is per child, ignores other kinds, and a date holds on its day in the family's zone", () => {
    const rows = [row("a", "cdc-2mo-x", "2027-02-01T02:00:00Z"), row("b", "cdc-2mo-x", "2027-02-01T02:00:00Z", "other"), { ...row("c", "cdc-2mo-y", "2027-02-01T02:00:00Z"), kind: "journal" } as BabyRecord];
    expect([...checkedMilestones(rows, "kid").keys()]).toEqual(["cdc-2mo-x"]);
    const noon = milestoneInstant("2027-02-01", "Pacific/Guam");
    expect(recordDay(noon.toISOString(), "Pacific/Guam")).toBe("2027-02-01");
  });
  it("two phones checking the same one keep the earliest date and one keepsake", () => {
    const checked = checkedMilestones([row("late", "cdc-2mo-x", "2027-02-05T02:00:00Z"), row("early", "cdc-2mo-x", "2027-02-01T02:00:00Z"), row("new", "cdc-2mo-y", "2027-02-09T02:00:00Z")], "kid");
    expect(checked.get("cdc-2mo-x")!.map((one) => one.id)).toEqual(["early", "late"]);
    expect(keepsakes(checked).map((one) => one.id)).toEqual(["new", "early"]);
  });
  it("takes dates from birth to today only", () => {
    expect(acceptableDay("2027-01-01", "2027-01-01", "2027-02-01")).toBe(true);
    expect(acceptableDay("2026-12-31", "2027-01-01", "2027-02-01")).toBe(false);
    expect(acceptableDay("2027-02-02", "2027-01-01", "2027-02-01")).toBe(false);
  });
});

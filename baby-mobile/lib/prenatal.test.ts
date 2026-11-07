import { describe, expect, it } from "vitest";
import { estimatedAge, snapshotVisit } from "./prenatal";
import { pasteVisits, validDay, withPasteYear } from "./paste-visits";
import type { EditorDraft } from "./models";
describe("pregnancy history without interpretation", () => {
  it("uses calendar days and retains the original due date and clinic words", () => {
    const draft: EditorDraft = { id: "one", kind: "event", title: "Visit", body: "", child_id: null, occurred_at: "2026-11-09T00:00:00Z", files: [], data: { category: "appointment", clinician_age: "35w per clinic" } };
    const saved = snapshotVisit(draft, "2026-12-10");
    expect(estimatedAge("2026-11-09", saved.data.due_date_snapshot)).toBe("35 weeks 4 days");
    expect(snapshotVisit(saved, "2026-12-15").data).toEqual(saved.data);
    expect(saved.data.clinician_age).toBe("35w per clinic");
    expect(estimatedAge("bad", "2026-12-10")).toBeNull();
  });
  it("preserves every character and never invents a date for ambiguous words", () => {
    const original = "First test 💛\n2026-04-01 clinic — 8 weeks\nGBS swab done\n2026-11-08 head down\n";
    const rows = pasteVisits(original);
    expect(rows.map((row) => row.text).join("")).toBe(original);
    expect(rows[0].day).toBe("");
    for (const row of rows) expect(original.slice(row.start, row.end)).toBe(row.text);
    expect(pasteVisits("Nov 9 class")[0].day).toBe("");
    expect(validDay("2026-02-30")).toBe(false);
    const long = "April 1, 2026 " + "original words 💛 ".repeat(2000);
    expect(pasteVisits(long).map((row) => row.text).join("")).toBe(long);
    const mixed = pasteVisits("April 1, 2026 First test\n4/3/26 Told family\nNov 9 Class\n2026-11-10 Visit");
    expect(mixed.map((row) => row.day)).toEqual(["2026-04-01", "", "", "2026-11-10"]);
  });
});

it("keeps an ordinal gap and distinguishes a dated memory from visits without renumbering", () => {
  const note = "We told family on April 4\n\n6th Visit - September 16, 2026\n27 weeks\n\n8th visit - October 15, 2026\n32 weeks";
  const rows = pasteVisits(note);
  expect(rows.map((row) => row.kind)).toEqual(["journal", "event", "event"]);
  expect(rows.map((row) => row.title)).toEqual(["We told family on April 4", "6th Visit", "8th visit"]);
  expect(rows[0].day).toBe("");
  expect(rows.map((row) => row.text).join("")).toBe(note);
});

it("never estimates or snapshots a visit on or after birth, including an old snapshot", () => {
  const draft: EditorDraft = { id: "born", kind: "event", title: "Newborn checkup", body: "", child_id: "baby", occurred_at: "2026-12-09T00:00:00Z", files: [], data: { category: "appointment", timezone: "UTC" } };
  expect(estimatedAge("2026-12-09", "2026-12-10", "2026-12-05")).toBeNull();
  expect(snapshotVisit(draft, "2026-12-10", "2026-12-05").data.due_date_snapshot).toBeUndefined();
  expect(snapshotVisit({ ...draft, data: { ...draft.data, due_date_snapshot: "2026-12-10" } }, "2026-12-10", "2026-12-05").data.due_date_snapshot).toBeNull();
  expect(estimatedAge("2026-12-04", "2026-12-10", "2026-12-05")).toBe("39 weeks 1 days");
});
it("keeps date-leading planning lines within their visit", () => {
  const text = "1st visit - November 6, 2026\n35 weeks\nDecember 2nd/3rd - induction talk\nAiming for after December 2nd/3rd\n\n2nd visit - November 13, 2026\n36 weeks";
  const rows = pasteVisits(text);
  expect(rows).toHaveLength(2); expect(rows[0].text).toContain("December 2nd/3rd - induction talk");
  expect(rows.map((r) => r.text).join("")).toBe(text);
});
it("keeps CRLF and mixed-case clinic ages verbatim", () => {
  const text = "1st visit - May 6, 2026\r\n 8 WEEKS currently \r\n\r\n2nd Visit - June 3, 2026\r\n12 Week 6 Days\r\n";
  const rows = pasteVisits(text); expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.age)).toEqual([" 8 WEEKS currently ", "12 Week 6 Days"]);
  expect(rows.map((r) => r.text).join("")).toBe(text);
});
it("does not interpret a four digit time as a year", () => {
  expect(pasteVisits("Apr 16 1030 first official test")[0]).toMatchObject({ day: "", yearless: "04-16" });
});

it("separates consecutive ordinal visits and reads an immediately following standalone date", () => {
  const text = "1st Visit\nMay 6, 2026\n8 weeks\nDecember 2nd/3rd - planning\n2nd Visit - June 3, 2026\n12 weeks";
  const rows = pasteVisits(text);
  expect(rows.map((r) => r.day)).toEqual(["2026-05-06", "2026-06-03"]);
  expect(rows[0].text).toContain("December 2nd/3rd - planning");
  expect(rows.map((r) => r.text).join("")).toBe(text);
});
it("replaces a previously valid leap date instead of keeping the old year", () => {
  const rows = withPasteYear(withPasteYear(pasteVisits("February 29 first test"), "2024"), "2025");
  expect(rows[0].day).toBe("2025-02-29"); expect(validDay(rows[0].day)).toBe(false);
});


describe("suggested pregnancy-note year", () => {
  it("only suggests a shared year when every missing-year date fits the pregnancy", async () => {
    const { pasteVisits, suggestedPasteYear } = await import("./paste-visits");
    expect(suggestedPasteYear(pasteVisits("First test April 4\n\nTold family April 10"), "2026-12-10")).toBe("2026");
    expect(suggestedPasteYear(pasteVisits("First test January 4"), "2026-12-10")).toBeNull();
    expect(suggestedPasteYear(pasteVisits("First test April 4"))).toBeNull();
    expect(suggestedPasteYear(pasteVisits("First test December 4"), "2026-03-10")).toBe("2025");
    expect(suggestedPasteYear(pasteVisits("First test December 4\n\nTold family January 10"), "2026-03-10")).toBeNull();
    expect(suggestedPasteYear(pasteVisits("First test February 29"), "2026-09-10")).toBeNull();
  });
});

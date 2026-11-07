import { describe, expect, it } from "vitest";
import { estimatedAge, snapshotVisit } from "./prenatal";
import { pasteVisits, validDay } from "./paste-visits";
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
    const mixed = pasteVisits("April 1, 2026 First test\n4/3/26 Told family\nNov 9 Class\n2026-11-10 Visit");
    expect(mixed.map((row) => row.day)).toEqual(["2026-04-01", "", "", "2026-11-10"]);
  });
});

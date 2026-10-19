import { describe, expect, it } from "vitest";
import { optimisticRecord } from "./models";
import { visitSummary } from "./visit-summary";
const entry = optimisticRecord({ id: "one", kind: "feeding", title: "Feeding", body: "A selected observation.", child_id: "child", occurred_at: "2026-10-19T15:00:00Z", data: {} });
const children = [{ id: "child", name: "QA Baby", revision: 1 }];
describe("selected visit export", () => {
  it("retains feeding measurements, child identity, timezone and the user's notes", () => {
    const text = visitSummary([{ ...entry, data: { method: "breast", side: "left", duration_minutes: 15, amount: null } },
      { ...entry, id: "two", data: { method: "bottle", amount: 90, unit: "ml" } }], children, "Pacific/Guam");
    for (const value of ["QA Baby", "Pacific/Guam", "Breastfeeding", "Left side", "15 minutes", "Bottle feeding", "90 mL", entry.body]) expect(text).toContain(value);
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });
  it("includes completed and open sleep, diaper type and the clinician-label qualification", () => {
    const text = visitSummary([
      { ...entry, kind: "sleep", data: { end_at: "2026-10-19T15:40:00Z" } },
      { ...entry, kind: "sleep", data: {} },
      { ...entry, kind: "diaper", data: { type: "both" } },
      { ...entry, kind: "question", child_id: null, data: { provenance: "clinician_instruction" } },
    ], children, "Pacific/Guam");
    for (const value of ["40 minutes", "Sleep in progress", "Wet + dirty diaper", "General / personal", "labelled by you, not verified by AI", "not a medical assessment"]) expect(text).toContain(value);
  });
});

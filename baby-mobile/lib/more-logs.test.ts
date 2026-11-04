import { describe, expect, it, vi } from "vitest";
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
import type { BabyRecord } from "./models";
import { careSummary, weightText } from "./care-format";
import { dataFrom, formFrom, lastLog, logTitle, moreKinds, noteLabel, recentCustomLabels, recentMedicines, recentVitamins, startForm } from "./more-logs";
import { retriedSave } from "./outbox";
import { panelTrackers, shotLabel, trackerById, trackerFor, trackers, trackersFor } from "./trackers";
import { datedOnly } from "./well-visits";
import { timelineKinds } from "./tracker";

const row = (kind: BabyRecord["kind"], data: Record<string, unknown>, at = "2026-11-04T10:00:00.000Z", title = "Entry", child: string | null = "baby") =>
  ({ id: `${kind}-${at}-${title}`, kind, title, body: "", child_id: child, occurred_at: at, data, revision: 1, created_at: at, updated_at: at }) as BabyRecord;
const form = (id: string, over: Partial<ReturnType<typeof startForm>> = {}) => ({ ...startForm(id, [], "baby"), ...over });

describe("the one list of trackers", () => {
  const ids = (list: readonly { id: string }[]) => list.map((tracker) => tracker.id);
  const on = (stage: "expecting" | "born") => ids(trackers.filter((tracker) => tracker.defaultOn.includes(stage)));
  it("starts each stage as EXACT_PLAN section 16's table says", () => {
    expect(on("expecting")).toEqual(["kicks", "contractions", "feeling", "my_weight", "blood_pressure", "vitamins"]);
    expect(on("born")).toEqual(["breast", "bottle", "diaper", "sleep"]);
    expect(ids(trackersFor("born"))).toEqual(["breast", "bottle", "diaper", "sleep", "pumping", "medicine", "temperature", "growth", "note", "custom"]);
    expect(ids(panelTrackers("expecting"))).toEqual(["feeling", "my_weight", "blood_pressure", "vitamins"]);
  });
  it("gives every tracker what Add and what-shows need, once each", () => {
    expect(new Set(ids(trackers)).size).toBe(trackers.length);
    for (const tracker of trackers) {
      expect(tracker.label && tracker.icon && tracker.kind).toBeTruthy();
      if (tracker.kind === "custom" && tracker.id !== "custom") expect(tracker.dataLabel).toBeTruthy();
      if (tracker.opens === "panel") expect(moreKinds).toContain(tracker.kind);
    }
  });
  it("keeps her logs off the baby, and the baby's on", () => {
    expect(ids(trackers.filter((tracker) => tracker.about === "her"))).toEqual(["feeling", "my_weight", "blood_pressure", "vitamins"]);
  });
  it("finds a saved entry's tracker, and leaves a shot to Well visits", () => {
    expect(trackerFor(row("custom", { label: "My weight" }))?.id).toBe("my_weight");
    expect(trackerFor(row("custom", { label: noteLabel }))?.id).toBe("note");
    expect(trackerFor(row("custom", { label: "Bath" }))?.id).toBe("custom");
    expect(trackerFor(row("custom", { label: shotLabel }))).toBeUndefined();
    expect(trackerFor(row("pumping", {}))?.id).toBe("pumping");
    expect(trackerFor(row("feeding", { method: "bottle" }))?.id).toBe("bottle");
  });
});

describe("what she logs about herself", () => {
  it("keeps exactly what she typed, in custom entries the API accepts, and no reading of it", () => {
    expect(dataFrom("my_weight", form("my_weight", { myWeight: "145.5" }))).toEqual({ label: "My weight", value: 145.5, unit: "lb" });
    expect(dataFrom("my_weight", form("my_weight", { myWeight: "66", myWeightUnit: "kg" }))).toEqual({ label: "My weight", value: 66, unit: "kg" });
    expect(careSummary("custom", { label: "My weight", value: 145.5, unit: "lb" } as never, "")).toBe("My weight · 145.5 lb");
    const pressure = form("blood_pressure", { top: "118", bottom: "76" });
    expect(dataFrom("blood_pressure", pressure)).toEqual({ label: "Blood pressure" });
    expect(logTitle("blood_pressure", pressure)).toBe("118/76");
    expect(dataFrom("vitamins", form("vitamins", { name: "Prenatal" }))).toEqual({ label: "Vitamins and medicine" });
    expect(logTitle("vitamins", form("vitamins", { name: " Prenatal " }))).toBe("Prenatal");
    expect(dataFrom("feeling", form("feeling", { name: "Tired" }))).toEqual({ label: "How I'm feeling" });
  });
  it("takes any reading: a number only fails if it isn't one, never for being high or low", () => {
    expect(() => dataFrom("blood_pressure", form("blood_pressure", { top: "118", bottom: "" }))).toThrow("both");
    expect(() => dataFrom("blood_pressure", form("blood_pressure", { top: "abc", bottom: "76" }))).toThrow("Check");
    for (const [top, bottom] of [["190", "120"], ["70", "40"]]) expect(dataFrom("blood_pressure", form("blood_pressure", { top, bottom }))).toEqual({ label: "Blood pressure" });
    expect(() => dataFrom("my_weight", form("my_weight"))).toThrow("weight");
  });
  it("opens them for editing from what they hold", () => {
    expect(formFrom("blood_pressure", { label: "Blood pressure" }, "118/76")).toMatchObject({ top: "118", bottom: "76" });
    expect(formFrom("my_weight", { label: "My weight", value: 66, unit: "kg" } as never)).toMatchObject({ myWeight: "66", myWeightUnit: "kg" });
    expect(formFrom("vitamins", { label: "Vitamins and medicine" }, "Prenatal")).toMatchObject({ name: "Prenatal" });
  });
  it("offers vitamins she's taken again, and remembers her weight's unit", () => {
    const rows = [row("custom", { label: "Vitamins and medicine" }, "2026-11-04T08:00:00.000Z", "Prenatal", null), row("custom", { label: "Vitamins and medicine" }, "2026-11-04T09:00:00.000Z", "prenatal", null)];
    expect(recentVitamins(rows, null).map((one) => one.name)).toEqual(["prenatal"]);
    expect(startForm("my_weight", [row("custom", { label: "My weight", value: 66, unit: "kg" }, undefined, "My weight", null)], null)).toMatchObject({ myWeightUnit: "kg" });
  });
});

describe("what each log saves", () => {
  it("saves pumping in the API's shape", () => {
    expect(dataFrom("pumping", form("pumping", { side: "left", amount: "3.5", amountUnit: "oz" }))).toEqual({ side: "left", amount: 3.5, unit: "oz" });
    expect(() => dataFrom("pumping", form("pumping", { side: "left", amount: "20000", amountUnit: "ml" }))).toThrow();
  });
  it("needs a medicine's name, and the dose is optional", () => {
    expect(() => dataFrom("medicine", form("medicine", { name: "  " }))).toThrow("name");
    expect(dataFrom("medicine", form("medicine", { name: " Vitamin D " }))).toEqual({ name: "Vitamin D" });
    expect(dataFrom("medicine", form("medicine", { name: "Vitamin D", dose: "1 mL" }))).toEqual({ name: "Vitamin D", dose: "1 mL" });
    expect(logTitle("medicine", form("medicine", { name: " Vitamin D " }))).toBe("Vitamin D");
  });
  it("reads a temperature typed with a comma, and refuses one on the wrong scale", () => {
    expect(dataFrom("temperature", form("temperature", { value: "37,5", unit: "c" }))).toEqual({ value: 37.5, unit: "c" });
    expect(dataFrom("temperature", form("temperature", { value: "99.1", unit: "f", method: "armpit" }))).toEqual({ value: 99.1, unit: "f", method: "armpit" });
    expect(() => dataFrom("temperature", form("temperature", { value: "37", unit: "f" }))).toThrow("Check");
    expect(() => dataFrom("temperature", form("temperature", { value: "98.6", unit: "c" }))).toThrow("Check");
    expect(() => dataFrom("temperature", form("temperature", { value: "986", unit: "f" }))).toThrow("Check");
    expect(() => dataFrom("temperature", form("temperature", { value: "", unit: "f" }))).toThrow("temperature");
  });
  it("takes pounds and ounces as the doctor says them, so 7 lb 8 oz is never saved as 7.8 lb", () => {
    const data = dataFrom("growth", form("growth", { lb: "7", oz: "8" }));
    expect(data).toEqual({ weight: 7.5, weight_unit: "lb" });
    expect(() => dataFrom("growth", form("growth", { lb: "7", oz: "16" }))).toThrow("ounces");
    expect(dataFrom("growth", form("growth", { oz: "12" }))).toEqual({ weight: 0.75, weight_unit: "lb" });
    expect(dataFrom("growth", form("growth", { weightUnit: "kg", kg: "3.4", length: "50.8", lengthUnit: "cm", head: "14", headUnit: "in" })))
      .toEqual({ weight: 3.4, weight_unit: "kg", length: 50.8, length_unit: "cm", head: 14, head_unit: "in" });
    expect(() => dataFrom("growth", form("growth"))).toThrow("measurement");
    expect(() => dataFrom("growth", form("growth", { length: "301", lengthUnit: "cm" }))).toThrow("Check");
  });
  it("shows a weight back the way it went in, carrying a rounded ounce", () => {
    expect(weightText(7.5, "lb")).toBe("7 lb 8 oz");
    expect(weightText(7 + 8.5 / 16, "lb")).toBe("7 lb 8.5 oz");
    expect(weightText(7.999, "lb")).toBe("8 lb 0 oz");
    expect(weightText(3.4, "kg")).toBe("3.4 kg");
  });
  it("opens an entry for editing with what it holds, keeping fields the form doesn't show", () => {
    const growth = formFrom("growth", { weight: 7.5, weight_unit: "lb", length: 20, length_unit: "in" });
    expect(growth).toMatchObject({ weightUnit: "lb", lb: "7", oz: "8", length: "20", lengthUnit: "in", head: "" });
    expect(dataFrom("growth", growth)).toEqual({ weight: 7.5, weight_unit: "lb", length: 20, length_unit: "in" });
    const end = "2026-11-04T10:20:00.000Z";
    expect(dataFrom("pumping", formFrom("pumping", { side: "both", amount: 4, unit: "oz", duration_minutes: 20, end_at: end }), { end_at: end }))
      .toEqual({ side: "both", amount: 4, unit: "oz", duration_minutes: 20, end_at: end });
    const custom = { label: "Bath", value: 2, unit: "min" };
    expect(dataFrom("custom", formFrom("custom", custom as never), custom)).toEqual(custom);
  });
});

describe("starting from the last one", () => {
  it("remembers the units last used for this baby", () => {
    expect(trackerById("growth")?.kind).toBe("growth");
    const rows = [row("temperature", { value: 37.2, unit: "c" }), row("growth", { weight: 3.4, weight_unit: "kg", length: 50, length_unit: "cm" })];
    expect(startForm("temperature", rows, "baby")).toMatchObject({ unit: "c", value: "" });
    expect(startForm("growth", rows, "baby")).toMatchObject({ weightUnit: "kg", lengthUnit: "cm", kg: "" });
    expect(startForm("temperature", rows, "other")).toMatchObject({ unit: "f" });
  });
  it("offers the last few medicines once each, newest first, for this baby only", () => {
    const rows = [
      row("medicine", { name: "Vitamin D", dose: "1 mL" }, "2026-11-04T08:00:00.000Z"),
      row("medicine", { name: "vitamin d", dose: "1 mL" }, "2026-11-04T09:00:00.000Z"),
      row("medicine", { name: "Gas drops" }, "2026-11-04T07:00:00.000Z"),
      row("medicine", { name: "Other baby's" }, "2026-11-04T09:30:00.000Z", "Entry", "other"),
    ];
    expect(recentMedicines(rows, "baby").map((one) => one.name)).toEqual(["vitamin d", "Gas drops"]);
  });
  it("offers custom labels, without a shot or a note, which have their own places", () => {
    const rows = [row("custom", { label: "Bath" }), row("custom", { label: shotLabel }), row("custom", { label: noteLabel }), row("custom", { label: "Tummy time" }, "2026-11-04T09:00:00.000Z")];
    expect(recentCustomLabels(rows, "baby")).toEqual(["Bath", "Tummy time"]);
  });
  it("finds the last of a kind", () => {
    const older = row("pumping", { side: "left" }, "2026-11-04T08:00:00.000Z"), newer = row("pumping", { side: "right" }, "2026-11-04T09:00:00.000Z");
    expect(lastLog([older, newer], "pumping", "baby")).toBe(newer);
  });
});

describe("in Tracker and everywhere else", () => {
  it("reads each log in one line", () => {
    expect(careSummary("pumping", { side: "both", amount: 4, unit: "oz" } as never, "")).toBe("Pumping · Both sides · 4 oz");
    expect(careSummary("medicine", { name: "Vitamin D", dose: "1 mL" } as never, "")).toBe("Medicine · Vitamin D · 1 mL");
    expect(careSummary("temperature", { value: 99.1, unit: "f", method: "armpit" } as never, "")).toBe("Temperature · 99.1 °F · Armpit");
    expect(careSummary("growth", { weight: 7.5, weight_unit: "lb", length: 20, length_unit: "in", head: 35, head_unit: "cm" } as never, "")).toBe("Growth · 7 lb 8 oz · 20 in · Head 35 cm");
  });
  it("gives a shot only a date, and a log made at a time its time", () => {
    expect(datedOnly(row("custom", { label: shotLabel }))).toBe(true);
    expect(datedOnly(row("milestone", {}))).toBe(true);
    expect(datedOnly(row("custom", { label: "Bath" }))).toBe(false);
    expect(datedOnly(row("medicine", { name: "Vitamin D" }))).toBe(false);
  });
  it("shows them all on the day, and keeps them queued while the API's flag is off", () => {
    for (const kind of ["pumping", "medicine", "temperature", "growth"] as const) {
      expect(timelineKinds).toContain(kind);
      expect(retriedSave({ id: "m", generation: 1, type: "save", files: [], record: row(kind, {}) })).toBe(true);
    }
  });
});

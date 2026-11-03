import { describe, expect, it } from "vitest";
import { WORKOUT_GRID_GAP, largeText, workoutGridColumns, workoutGridWidth } from "./readable-layout";
describe("workout grids", () => {
  it.each([320, 375, 390, 660])("uses all available width at large text on %dpt screens", width => {
    for (const scale of [1.3, 2, 3.1]) {
      expect(largeText(scale)).toBe(true);
      expect(workoutGridColumns(width, scale, true)).toBe(1);
      expect(workoutGridColumns(width, scale)).toBe(1);
      expect(workoutGridWidth(width, scale)).toBe(width - 40);
    }
  });
  it("preserves compact grids at normal type", () => {
    expect(workoutGridColumns(390, 1)).toBe(2);
    expect(workoutGridColumns(660, 1, true)).toBe(3);
    expect(workoutGridColumns(660, 1.29, true)).toBe(3);
  });
});

import { footerCellWidth, footerLabelScale } from "./readable-layout";
describe("two-column footer", () => {
  it("splits the width between the footer's side padding and the gap", () => {
    expect(footerCellWidth(390)).toBe((390 - 32 - 12) / 2);
    expect(footerCellWidth(1200)).toBe((660 - 32 - 12) / 2);
  });
  it("lets short words grow with the text size and shrinks only the label whose longest word would not fit", () => {
    const cell = footerCellWidth(390);
    expect(footerLabelScale("Pause", cell, 1.5)).toBe(1.5);
    expect(footerLabelScale("Done · interval 1", cell, 3.1)).toBeLessThan(footerLabelScale("Missed", cell, 3.1));
    expect(footerLabelScale("Done · interval 1", cell, 3.1)).toBeGreaterThan(1);
    expect(footerLabelScale("Done · interval 1", 100, 3.1)).toBe(1);
  });
});

it.each([320, 375, 390, 393, 660, 1200])("centres the grid with equal 20pt gutters at %dpt", width => {
  for (const discover of [true, false]) {
    const columns = workoutGridColumns(width, 1, discover);
    const used = columns * workoutGridWidth(width, 1, discover) + (columns - 1) * WORKOUT_GRID_GAP;
    expect((Math.min(width, 660) - used) / 2).toBeCloseTo(20);
  }
});

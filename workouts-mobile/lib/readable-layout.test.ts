import { describe, expect, it } from "vitest";
import { largeText, workoutGridColumns, workoutGridWidth } from "./readable-layout";
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

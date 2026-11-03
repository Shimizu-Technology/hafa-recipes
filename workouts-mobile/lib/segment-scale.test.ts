import { expect, it } from "vitest";
import { SEGMENT_MIN_SCALE, segmentLabelScale } from "./segment-scale";

it("waits for the track and every label before shrinking", () => {
  expect(segmentLabelScale(0, [20, 40])).toBe(1);
  expect(segmentLabelScale(300, [20, undefined])).toBe(1);
  expect(segmentLabelScale(300, [])).toBe(1);
});
it("keeps full size when the widest label fits its segment", () => {
  expect(segmentLabelScale(342, [30, 80, 100])).toBe(1);
});
it("shrinks everything by one factor so the widest label fits", () => {
  // 3 segments in 300pt: (300 - 4 - 4) / 3 = 97.3 per segment, 89.3 after side padding.
  const scale = segmentLabelScale(300, [30, 80, 150]);
  expect(scale).toBeLessThan(89.3 / 150);
  expect(scale).toBeGreaterThan(0.5);
  expect(150 * scale).toBeLessThanOrEqual(89.3);
});
it("never goes below the minimum scale", () => {
  expect(segmentLabelScale(300, [30, 80, 900])).toBe(SEGMENT_MIN_SCALE);
  expect(segmentLabelScale(10, [10, 10])).toBe(SEGMENT_MIN_SCALE);
});

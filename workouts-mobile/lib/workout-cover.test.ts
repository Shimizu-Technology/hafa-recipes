import { expect, it } from "vitest";
import { workoutCover } from "./workout-cover";
import type { FormatBlock } from "./timed-execution";
const cover = (execution: FormatBlock["execution"], rounds?: number) => workoutCover([{ execution, rounds, exercises: [] }], "");
it("uses real Tabata and interval prescriptions", () => {
  expect(cover({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 })).toEqual({ headline: "TABATA", caption: "8 rounds · 20s work / 10s rest" });
  expect(cover({ mode: "work_rest", work_seconds: 45, rest_seconds: 15, intervals: null })).toEqual({ headline: "INTERVALS", caption: "45s work / 15s rest" });
});
it("names for-time covers and preserves rounds and caps", () => {
  expect(cover({ mode: "for_time", time_cap_seconds: 720 }, 3)).toEqual({ headline: "FOR TIME", caption: "3 rounds · 12 min cap" });
  expect(cover({ mode: "for_time", time_cap_seconds: null }).caption).toBe("No time cap");
});
it("keeps one clean numeral for EMOM and AMRAP", () => {
  expect(cover({ mode: "emom", interval_seconds: 60, intervals: 10, rotation: null })).toEqual({ headline: "10", caption: "EMOM" });
  expect(cover({ mode: "amrap", time_cap_seconds: 1200 })).toEqual({ headline: "20", caption: "AMRAP" });
  expect(cover({ mode: "emom", interval_seconds: 120, intervals: 10, rotation: null }).headline).toBe("E2MOM × 10");
});
it("names strength and custom prescriptions without reading titles", () => {
  expect(workoutCover([{ exercises: [{ sets: 3 }] }], "45 min")).toEqual({ headline: "STRENGTH", caption: "45 MIN" });
  expect(workoutCover([{ exercises: [] }], "").headline).toBe("CUSTOM");
  expect(workoutCover(undefined, "4 wks")).toEqual({ headline: "4", caption: "WKS" });
});

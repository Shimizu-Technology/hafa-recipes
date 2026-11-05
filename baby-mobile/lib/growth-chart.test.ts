import { describe, expect, it, vi } from "vitest";
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
import { ageMonths, chartFromChild, curve, plottedIn, growthNotes, lmsAt, measuredOn, normalCdf, percentile, percentileWords, visibleGrowthNotes, whoGrowth, zScore, type ChartSex, type Measure } from "./growth-chart";
import type { BabyRecord } from "./models";

const row = (data: Record<string, unknown>, at: string, child = "baby") =>
  ({ id: at, kind: "growth", title: "Growth", body: "", child_id: child, occurred_at: at, data, revision: 1, created_at: at, updated_at: at }) as BabyRecord;

describe("hand-checked percentiles", () => {
  // Worked by hand from one row of CDC's file. Each lands between the two columns CDC prints around it.
  it("boy, 6 months, 8.5 kg: 74th, between CDC's 50th (7.934) and 75th (8.539707)", () => {
    // WHO-Boys-Weight-for-age-Percentiles.csv, month 6: L 0.1257, M 7.934, S 0.10958.
    // z = ((8.5 / 7.934)^0.1257 - 1) / (0.1257 x 0.10958) = 0.00870 / 0.013774 = 0.6316, and Φ(0.6316) = 73.62%.
    expect(lmsAt("boys", "weight", 6)).toEqual({ L: 0.1257, M: 7.934, S: 0.10958 });
    expect(zScore(8.5, { L: 0.1257, M: 7.934, S: 0.10958 })).toBeCloseTo(0.6316, 3);
    const value = percentile("boys", "weight", 6, 8.5)!;
    expect(value).toBeCloseTo(73.62, 1);
    expect(percentileWords(value)).toBe("74th percentile");
  });
  it("girl, at birth, 7 lb 8 oz: 64th, between CDC's 50th (3.2322) and 75th (3.55035)", () => {
    // 7.5 lb = 3.40194 kg. Girls' file, month 0: L 0.3809, M 3.2322, S 0.14171. z = 0.3647, Φ = 64.23%.
    const value = percentile("girls", "weight", 0, 7.5 * 0.45359237)!;
    expect(value).toBeCloseTo(64.23, 1);
    expect(percentileWords(value)).toBe("64th percentile");
  });
  it("boy, 75 days, 60 cm long: 54th, with L, M and S read between two months of CDC's file", () => {
    // 75 / 30.4375 = 2.4641 months. Month 2: M 58.4249, S 0.03424. Month 3: M 61.4292, S 0.03328. L is 1.
    // At 0.4641 of the way: M = 59.8191, S = 0.033794. z = (60 / 59.8191 - 1) / 0.033794 = 0.0895, Φ = 53.57%.
    expect(ageMonths("2026-01-01", "2026-03-17")).toBeCloseTo(75 / 30.4375, 6);
    expect(percentile("boys", "length", 75 / 30.4375, 60)).toBeCloseTo(53.57, 1);
  });
  it("a negative L and a head size agree too", () => {
    expect(percentile("girls", "weight", 6, 7)).toBeCloseTo(36.65, 1);
    expect(percentile("girls", "head", 12, 45)).toBeCloseTo(53.04, 1);
  });
});

describe("CDC's own columns", () => {
  const z = [-2, -1.645, -1.282, -0.674, 0, 0.674, 1.282, 1.645, 2];
  it("puts every printed value in all six files back on its own percentile, so the file was bundled intact", () => {
    for (const sex of ["boys", "girls"] as ChartSex[]) for (const measure of ["weight", "length", "head"] as Measure[]) {
      expect(whoGrowth.charts[sex][measure]).toHaveLength(25);
      for (const line of whoGrowth.charts[sex][measure]) {
        const [month, L, M, S, ...printed] = line;
        printed.forEach((value, index) => expect(zScore(value, { L, M, S })).toBeCloseTo(z[index], 2));
        expect(lmsAt(sex, measure, month)).toEqual({ L, M, S });
      }
    }
  });
  it("keeps the source, and the file hashes it was built from", () => {
    expect(whoGrowth.source.url).toBe("https://www.cdc.gov/growthcharts/who-data-files.htm");
    expect(Object.keys(whoGrowth.source.sha256)).toHaveLength(6);
    expect(whoGrowth.units).toEqual({ weight: "kg", length: "cm", head: "cm" });
  });
  it("draws a line from CDC's column in the unit she uses", () => {
    expect(curve("boys", "weight", 50, "kg")[6]).toEqual({ months: 6, value: 7.934 });
    expect(curve("boys", "length", 50, "in")[0].value).toBeCloseTo(49.8842 / 2.54, 6);
    expect(curve("boys", "weight", 98, "lb")[0].value).toBeCloseTo(4.419354 / 0.45359237, 6);
  });
});

describe("the words", () => {
  it("names the percentile, and stops at the lines CDC draws", () => {
    expect(percentileWords(1)).toBe("Below the 2nd percentile line");
    expect(percentileWords(2.2)).toBe("Below the 2nd percentile line");
    expect(percentileWords(normalCdf(-2) * 100)).toBe("2nd percentile");
    expect(percentileWords(3.4)).toBe("3rd percentile");
    expect(percentileWords(11)).toBe("11th percentile");
    expect(percentileWords(21)).toBe("21st percentile");
    expect(percentileWords(50)).toBe("50th percentile");
    expect(percentileWords(normalCdf(2) * 100)).toBe("98th percentile");
    expect(percentileWords(98)).toBe("Above the 98th percentile line");
  });
  it("holds our own lines until a doctor approves them", () => {
    expect(growthNotes.approved).toBe(false);
    expect(visibleGrowthNotes()).toEqual([]);
    expect(visibleGrowthNotes({ approved: true, notes: ["reviewed"] })).toEqual(["reviewed"]);
  });
  it("carries CDC's attribution and non-endorsement, and only CDC's words otherwise", () => {
    expect(growthNotes.cdc.attribution).toContain("Source: CDC");
    expect(growthNotes.cdc.attribution).toContain("available for free on CDC's website");
    expect(growthNotes.cdc.non_endorsement).toContain("does not imply endorsement");
    for (const line of [...growthNotes.cdc.lines, growthNotes.cdc.after_two]) expect(line.url).toMatch(/^https:\/\/www\.cdc\.gov\//);
  });
});

describe("a baby's measurements", () => {
  const child = { id: "baby", birth_date: "2026-12-10" };
  it("plots each in chart units, by age, oldest first, for this baby and this measure only", () => {
    const rows = [
      row({ weight: 7.5, weight_unit: "lb", length: 20, length_unit: "in" }, "2027-01-10T02:00:00.000Z"),
      row({ weight: 3.4, weight_unit: "kg" }, "2026-12-10T02:00:00.000Z"),
      row({ length: 50, length_unit: "cm" }, "2026-12-20T02:00:00.000Z"),
      row({ weight: 9, weight_unit: "kg" }, "2027-01-05T02:00:00.000Z", "other"),
    ];
    const weights = measuredOn(rows, child, "girls", "weight", "Pacific/Guam");
    expect(weights.map((point) => point.day)).toEqual(["2026-12-10", "2027-01-10"]);
    expect(weights[0]).toMatchObject({ months: 0, text: "3.4 kg", metric: 3.4 });
    expect(weights[1].metric).toBeCloseTo(3.40194, 4);
    expect(weights[1]).toMatchObject({ text: "7 lb 8 oz" });
    expect(weights[1].percentile).toBeCloseTo(percentile("girls", "weight", 31 / 30.4375, 7.5 * 0.45359237)!, 6);
    expect(measuredOn(rows, child, "girls", "length", "Pacific/Guam").map((point) => point.text)).toEqual(["50 cm", "20 in"]);
  });
  it("counts age on the family's clock, not the phone's", () => {
    // 8 am on the 11th in Guam is still the 10th in UTC.
    const [point] = measuredOn([row({ weight: 3.4, weight_unit: "kg" }, "2026-12-10T22:00:00.000Z")], child, "girls", "weight", "Pacific/Guam");
    expect(point.day).toBe("2026-12-11");
    expect(point.months).toBeCloseTo(1 / 30.4375, 6);
  });
  it("gives no percentile outside the chart: before birth, past 24 months, or with no chart chosen", () => {
    const rows = [row({ weight: 3, weight_unit: "kg" }, "2026-12-01T02:00:00.000Z"), row({ weight: 13, weight_unit: "kg" }, "2029-01-01T02:00:00.000Z")];
    const points = measuredOn(rows, child, "girls", "weight", "Pacific/Guam");
    expect(points.map((point) => point.percentile)).toEqual([null, null]);
    expect(points.map((point) => point.onChart)).toEqual([false, false]);
    const [plain] = measuredOn([row({ weight: 3.4, weight_unit: "kg" }, "2026-12-10T02:00:00.000Z")], child, null, "weight", "Pacific/Guam");
    expect(plain).toMatchObject({ percentile: null, onChart: true, text: "3.4 kg" });
  });
  it("leaves off a stored value it can't read, rather than treating it as metric", () => {
    const at = "2026-12-20T02:00:00.000Z", child = { id: "baby", birth_date: "2026-12-10" };
    const rows = [row({ weight: 7.5, weight_unit: "g" }, at), row({ weight: 7.5, weight_unit: "oz" }, at), row({ weight: -1, weight_unit: "kg" }, at), row({ weight: Infinity, weight_unit: "kg" }, at)];
    expect(measuredOn(rows, child, "girls", "weight", "Pacific/Guam")).toEqual([]);
  });
  it("gives no percentile to a measurement dated after today", () => {
    const child = { id: "baby", birth_date: "2026-12-10" }, rows = [row({ weight: 3.4, weight_unit: "kg" }, "2027-01-20T02:00:00.000Z")];
    expect(measuredOn(rows, child, "girls", "weight", "Pacific/Guam", "2027-01-01")[0]).toMatchObject({ onChart: false, percentile: null });
    expect(measuredOn(rows, child, "girls", "weight", "Pacific/Guam", "2027-01-20")[0].percentile).not.toBeNull();
  });
});

describe("which chart a baby's profile points to", () => {
  it("reads the answer when there is one, and assumes nothing when there isn't", () => {
    expect(chartFromChild({ details: { sex: "girl" } })).toBe("girls");
    expect(chartFromChild({ details: { sex: "Boy" } })).toBe("boys");
    for (const child of [{}, { details: {} }, { details: { sex: null } }, { details: { sex: "not_sure" } }, { details: { sex: "Not sure yet" } }, { details: null }]) expect(chartFromChild(child)).toBeNull();
  });
});

it("converts a measurement to the chart's unit for plotting", () => {
  const [point] = measuredOn([row({ weight: 7.5, weight_unit: "lb" }, "2026-12-10T02:00:00.000Z")], { id: "baby", birth_date: "2026-12-10" }, "girls", "weight", "Pacific/Guam");
  expect(plottedIn(point, "lb")).toBeCloseTo(7.5, 6);
  expect(plottedIn(point, "kg")).toBeCloseTo(3.40194, 4);
});

describe("the measurement at birth", () => {
  const kid = (details: object) => ({ id: "baby", birth_date: "2026-11-01", details }), born = { weight_at_birth_g: 3345, length_at_birth_cm: 50.8 };
  it("comes first, from her setup answers, marked as the birth measurement, with no entry behind it", () => {
    const [first, later] = measuredOn([row({ weight: 10, weight_unit: "lb" }, "2026-12-01T03:00:00.000Z")], kid(born), "girls", "weight", "UTC", "2027-01-01");
    expect(first).toMatchObject({ atBirth: true, record: null, months: 0, day: "2026-11-01", onChart: true, unit: "lb", text: "7 lb 6 oz" });
    expect(first.metric).toBeCloseTo(3.345);
    expect(first.percentile).toBeCloseTo(percentile("girls", "weight", 0, 3.345)!);
    expect(later.atBirth).toBeFalsy();
  });
  it("reads in the unit she logs in, or else pounds and inches", () => {
    const logged = measuredOn([row({ length: 60, length_unit: "cm" }, "2026-12-01T03:00:00.000Z")], kid(born), "girls", "length", "UTC", "2027-01-01");
    expect(logged[0]).toMatchObject({ unit: "cm", text: "50.8 cm" });
    expect(measuredOn([], kid(born), "girls", "length", "UTC", "2027-01-01")[0]).toMatchObject({ unit: "in", text: "20 in" });
    expect(measuredOn([row({ weight: 4, weight_unit: "kg" }, "2026-12-01T03:00:00.000Z")], kid(born), null, "weight", "UTC", "2027-01-01")[0]).toMatchObject({ text: "3.35 kg", percentile: null });
  });
  it("isn't drawn twice when she also logged that measure on the birth day", () => {
    const same = row({ weight: 7.4, weight_unit: "lb" }, "2026-11-01T22:00:00.000Z");
    const points = measuredOn([same], kid(born), "girls", "weight", "UTC", "2027-01-01");
    expect(points).toHaveLength(1);
    expect(points[0].record).toBe(same);
    // A length logged that day says nothing about the weight.
    expect(measuredOn([row({ length: 51, length_unit: "cm" }, "2026-11-01T22:00:00.000Z")], kid(born), "girls", "weight", "UTC", "2027-01-01")[0].atBirth).toBe(true);
  });
  it("has nothing to add without an answer, a birth date, or for head", () => {
    expect(measuredOn([], kid({}), "girls", "weight", "UTC", "2027-01-01")).toEqual([]);
    expect(measuredOn([], { id: "baby", birth_date: null, details: born }, "girls", "weight", "UTC", "2027-01-01")).toEqual([]);
    expect(measuredOn([], kid(born), "girls", "head", "UTC", "2027-01-01")).toEqual([]);
    expect(measuredOn([], { id: "baby", birth_date: "2026-11-01" }, "girls", "weight", "UTC", "2027-01-01")).toEqual([]);
  });
});

describe("birth point changes", () => {
  const birth = { id: "baby", birth_date: "2026-11-01", details: { weight_at_birth_g: 3345, length_at_birth_cm: 50.8 } };
  it("reflects edited details, with no stale saved copy of the birth point", () => {
    expect(measuredOn([], birth, "girls", "weight")[0].metric).toBe(3.345);
    expect(measuredOn([], { ...birth, details: { ...birth.details, weight_at_birth_g: 3500 } }, "girls", "weight")[0].metric).toBe(3.5);
  });
  it("removing the birth date removes its synthetic point", () => {
    expect(measuredOn([], { ...birth, birth_date: null }, "girls", "weight")).toEqual([]);
  });
  it("suppresses a duplicate by the profile's local birth day", () => {
    // Oct 31 UTC is Nov 1 in Guam.
    const rows = [row({ weight: 3.4, weight_unit: "kg" }, "2026-10-31T22:00:00.000Z")];
    expect(measuredOn(rows, birth, "girls", "weight", "Pacific/Guam")).toHaveLength(1);
    expect(measuredOn(rows, birth, "girls", "weight", "Pacific/Guam")[0].atBirth).toBeUndefined();
  });
  it("never uses a second baby's same-day measure to suppress this baby's point", () => {
    const points = measuredOn([row({ weight: 4, weight_unit: "kg" }, "2026-11-01T02:00:00.000Z", "other")], birth, "girls", "weight", "Pacific/Guam");
    expect(points).toHaveLength(1); expect(points[0].atBirth).toBe(true);
  });
});

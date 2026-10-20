import { expect, it } from "vitest";
import { defaultLoadUnit, distanceText, distanceUnit, typedDistance } from "./workout-units";

it("labels distance in the person's units", () => {
  expect(distanceUnit("imperial")).toBe("miles");
  expect(distanceUnit("metric")).toBe("metres");
  expect(defaultLoadUnit("imperial")).toBe("lb");
  expect(defaultLoadUnit("metric")).toBe("kg");
});

it("shows stored metres as miles for imperial and unchanged for metric", () => {
  expect(distanceText(400, "imperial")).toBe("0.25");
  expect(distanceText(1609.344, "imperial")).toBe("1");
  expect(distanceText(400, "metric")).toBe("400");
});

it("saves typed miles as metres and keeps blank and invalid input visible to validation", () => {
  expect(typedDistance("1", "imperial")).toBe(1609.34);
  expect(typedDistance("0,5", "imperial")).toBe(804.67);
  expect(typedDistance("400", "metric")).toBe(400);
  expect(typedDistance("  ", "imperial")).toBeNull();
  expect(typedDistance("abc", "imperial")).toBeNaN();
});

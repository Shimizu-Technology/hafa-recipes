import { expect, it } from "vitest";
import { bodyLimit, overBy, titleLimit, tooLong } from "./text-limits";

it("counts as the API does, so 60,000 emoji fit and 100,001 of anything don't", () => {
  expect(overBy("😀".repeat(60000), bodyLimit)).toBe(0);
  expect(overBy("😀".repeat(100000), bodyLimit)).toBe(0);
  expect(overBy("😀".repeat(100001), bodyLimit)).toBe(1);
  expect(overBy("a".repeat(100000), bodyLimit)).toBe(0);
  expect(overBy("a".repeat(100001), bodyLimit)).toBe(1);
  // A combining mark is its own code point to the API.
  expect(overBy("é".repeat(50001), bodyLimit)).toBe(2);
  expect(overBy("😀".repeat(240), titleLimit)).toBe(0);
  expect(overBy("😀".repeat(241), titleLimit)).toBe(1);
});
it("says plainly what's over, that nothing was cut, and says nothing when it fits", () => {
  expect(tooLong("Title", "a".repeat(100001))).toBe("This entry is 1 character too long to save. Nothing has been cut. Shorten it to save.");
  expect(tooLong("x".repeat(2240), "Body")).toBe("This title is 2,000 characters too long to save. Nothing has been cut. Shorten it to save.");
  expect(tooLong("Title", "Body")).toBe("");
});

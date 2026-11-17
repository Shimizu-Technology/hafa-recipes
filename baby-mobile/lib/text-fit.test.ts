import { expect, it } from "vitest";
import { wordFitLimit } from "./text-fit";

it("caps the growth of text whose longest word would break at the largest sizes", () => {
  // iPhone width, less the gutters and card padding.
  const line = 393 - 2 * 16 - 2 * 22;
  const limit = wordFitLimit("Kami: contractions have started.", line);
  expect(limit).toBeGreaterThan(2);
  expect(limit).toBeLessThan(3);
  // 12 letters at 17pt × the cap are no wider than the line.
  expect(12 * 17 * 0.6 * limit).toBeLessThanOrEqual(line);
});
it("a narrower phone caps it sooner, and never below the normal size", () => {
  expect(wordFitLimit("contractions", 280)).toBeLessThan(wordFitLimit("contractions", 317));
  expect(wordFitLimit("contractions", 40)).toBe(1);
});
it("leaves short words and empty lines to grow as far as she's set", () => {
  expect(wordFitLimit("Reminder b", 317)).toBe(0);
  expect(wordFitLimit("", 317)).toBe(0);
  expect(wordFitLimit("contractions", 0)).toBe(0);
});
it("ignores punctuation when it finds the longest word", () => {
  expect(wordFitLimit("(contractions),", 317)).toBe(wordFitLimit("contractions", 317));
});

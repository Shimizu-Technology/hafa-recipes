import { expect, it } from "vitest";
import {
  importFinished,
  importRetryable,
  importLabel,
  importProblem,
  dailyAiLimitMessage,
  importCardVisible,
} from "./import-status";
it("uses the API's ready and incomplete states consistently across sync and recovery controls", () => {
  expect(importFinished("ready")).toBe(true);
  expect(importLabel("ready")).toBe("Source organized");
  expect(importRetryable("ready")).toBe(false);
  expect(importFinished("incomplete")).toBe(true);
  expect(importRetryable("incomplete", "Some source details need review.")).toBe(true);
  expect(importLabel("incomplete", "Some source details need review.")).toContain("needs attention");
  expect(importFinished("processing")).toBe(false);
  expect(importFinished("queued")).toBe(false);
});

it("shows only recognized static budget messages on import cards", () => {
  expect(importProblem(dailyAiLimitMessage)).toBe(dailyAiLimitMessage);
  expect(
    importProblem(
      "AI processing is temporarily unavailable. Your originals and available text are saved. Try again later."
    )
  ).toContain("temporarily unavailable");
  expect(importProblem("provider private response")).toBe(
    "Some information could not be extracted. Your original source is kept."
  );
  expect(importProblem("workouts_ai_budget_exceeded")).not.toContain("workouts");
});

it("treats successfully organized sampled media as complete with visible coverage in the source, not a retry failure", () => {
  expect(importFinished("incomplete")).toBe(true);
  expect(importLabel("incomplete", null)).toBe("Source organized · see processing notes");
  expect(importRetryable("incomplete", null)).toBe(false);
  expect(importCardVisible("incomplete", null)).toBe(false);
  expect(importCardVisible("ready", null)).toBe(false);
  expect(importCardVisible("queued", null)).toBe(true);
  expect(importCardVisible("processing", null)).toBe(true);
});
it("keeps actual incomplete/budget/provider failures in attention cards with retry", () => {
  for (const error of [
    dailyAiLimitMessage,
    "AI processing is temporarily unavailable. Your originals and available text are saved. Try again later.",
    "Some source details need review.",
  ]) {
    expect(importCardVisible("incomplete", error)).toBe(true);
    expect(importLabel("incomplete", error)).toContain("needs attention");
    expect(importRetryable("incomplete", error)).toBe(true);
  }
  expect(importCardVisible("failed", null)).toBe(true);
  expect(importCardVisible("ready", "Unexpected error")).toBe(true);
});

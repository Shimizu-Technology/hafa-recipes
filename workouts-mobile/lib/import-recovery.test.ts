import { expect, it } from "vitest";
import { recoverySource, importSourceLabel, importPresentation } from "./import-recovery";

it("strips server saving metadata and retains source instructions for a private retry", () => {
  const source = { kind: "url" as const, source_url: "https://example.test/reel", text: "10 squats", ai_consent: true,
    _save: { is_public: true, display_name: "Original contributor" } };
  const retry = recoverySource(source, null, "Repeat for 20 minutes");
  expect(retry.text).toBe("10 squats\n\nRepeat for 20 minutes");
  expect(retry).not.toHaveProperty("_save");
  expect(source.text).toBe("10 squats");
});

it("can recover from pasted caption alone when the temporary source has expired", () => {
  expect(recoverySource(null, null, "10 squats")).toMatchObject({ kind: "text", text: "10 squats", ai_consent: true });
  expect(() => recoverySource(null, null, "")).toThrow("no longer available");
  expect(() => recoverySource(null, null, "a".repeat(30001))).toThrow("30,000");
});

it("removes tracking query strings from inbox source labels", () => {
  expect(importSourceLabel("https://www.instagram.com/reel/abc/?token=private")).toBe("instagram.com/reel/abc");
});


it("distinguishes a processing failure from workout details that still need review", () => {
  const job = { status: "incomplete", result: { workout: { blocks: [{ exercises: [{ name: "Squat" }] }] } } } as import("./capture").ImportJob;
  expect(importPresentation(job).label).toBe("Needs a few details");
  job.result!.error_code = "workouts_ai_budget_exceeded";
  expect(importPresentation(job).label).toBe("AI importing temporarily paused");
  expect(job.result!.error_code).toBe("workouts_ai_budget_exceeded");
  job.result!.error_code = "workouts_ai_budget_unavailable";
  expect(importPresentation(job).label).toBe("Processing did not finish");
  job.result!.error_code = null;
  job.result!.workout!.blocks = [];
  expect(importPresentation(job).label).toBe("No exercises extracted");
});

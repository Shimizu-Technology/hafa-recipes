import { expect, it } from "vitest";
import { canSaveAutomatically, type ImportJob } from "./capture";
import { importProgressState } from "./import-progress";
import { sourceRecoveryRequest } from "./workout-source-recovery";
const job = { id: "job", status: "processing", attempt_count: 2 } as ImportJob;
it("never automatically accepts an existing-workout update", () => {
  expect(canSaveAutomatically({ ...job, status: "ready", replace_target: { workout_id: "saved", expected_revision: 1 },
    result: { status: "ready", workout: { title: "Workout", kind: "session", provenance: "user", blocks: [] }, warnings: [], evidence: [], source: { platform: "text", channels: [], coverage_notes: [] } } })).toBe(false);
});
it("uses actual queued time and actual retry scheduling without inventing progress percentages", () => {
  const now = Date.parse("2026-10-15T01:04:05Z");
  const progress = importProgressState({ ...job, status: "queued", attempt_count: 1, max_attempts: 3,
    created_at: "2026-10-15T01:00:00Z", next_attempt_at: "2026-10-15T01:05:05Z" }, now);
  expect(progress.elapsed).toBe("Elapsed since queued · 4m 5s");
  expect(progress.phase).toBe("Waiting to retry");
  expect(progress.attempt).toBe("Next attempt 2 of 3 · can start in 1m 0s");
  expect(progress).not.toHaveProperty("percentage");
  expect(importProgressState({ ...job, status: "queued", attempt_count: 1, max_attempts: 3,
    next_attempt_at: "2026-10-15T01:05:05Z" }, now + 60000).attempt).toBe("Next attempt 2 of 3 · waiting in the queue");
});
it("keeps older server responses useful without pretending to know elapsed time or retry limits", () => {
  const progress = importProgressState(job);
  expect(progress.elapsed).toBeNull(); expect(progress.attempt).toBe("Automatic retry · attempt 2");
});
it("recovers from caption alone and rejects invalid source requests before transport", () => {
  expect(sourceRecoveryRequest({ source_url: "", caption: "10 squats" })).toEqual({ kind: "text", text: "10 squats", ai_consent: true });
  expect(() => sourceRecoveryRequest({ source_url: "", caption: " " })).toThrow("Paste the creator");
  expect(() => sourceRecoveryRequest({ source_url: "https://user:password@example.test", caption: "" })).toThrow("without account credentials");
  expect(() => sourceRecoveryRequest({ source_url: "", caption: "a".repeat(30001) })).toThrow("30,000");
});

it.each([
  ["reading_source", "Reading the source"], ["reading_images", "Reading images"],
  ["reading_document", "Reading the document"], ["listening_video", "Listening to the video"],
  ["reading_frames", "Reading video frames"], ["extracting_workout", "Building your workout"], ["saving_workout", "Saving the result"],
] as const)("presents the actual %s stage without a percentage", (current_stage, phase) => {
  const progress = importProgressState({ ...job, current_stage });
  expect(progress.phase).toBe(phase); expect(progress).not.toHaveProperty("percentage");
});
it("ignores a previous attempt's stage while queued and falls back for an unfamiliar server stage", () => {
  expect(importProgressState({ ...job, status: "queued", current_stage: "reading_frames" }).phase).toBe("Waiting to retry");
  expect(importProgressState({ ...job, current_stage: "future_stage" as never }).phase).toBe("Trying the source again");
});

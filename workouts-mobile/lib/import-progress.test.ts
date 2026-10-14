import { expect, it } from "vitest";
import type { ImportJob } from "./capture";
import { importProgressState } from "./import-progress";
import { sourceRecoveryRequest } from "./workout-source-recovery";
const job = { id: "job", status: "processing", attempt_count: 2 } as ImportJob;
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

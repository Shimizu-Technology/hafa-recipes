import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
vi.mock("@/components/ui", () => ({ Card: "Card", Copy: "Copy" }));
import { WatchSessionSummary } from "../components/watch-session-summary";
import { nov17Class } from "./fixtures/nov17-class";
import { pruneHistory } from "./training";
it("shows local HR and split durations without requiring server HR", async () => {
  let view: ReturnType<typeof create>;
  await act(async () => { view = create(createElement(WatchSessionSummary, { workout: nov17Class,
    details: { heart_rate: { average: 144.6, max: 172 }, parts: [{ block_id: "a", start: "2026-11-17T00:00:00Z", end: "2026-11-17T00:15:00Z", active_seconds: 900, rounds: 3, skipped: false, heart_rate: { average: 148, max: 172 } }] },
    segments: [{ block_id: "a", kind: "round", index: 1, started_at: "2026-11-17T00:00:00Z", ended_at: "2026-11-17T00:03:12Z" }] })); });
  const text = JSON.stringify(view!.toJSON());
  expect(text).toContain("Avg 145 · Max 172"); expect(text).toContain("3:12"); expect(text).toContain("Heart rate stays on this phone and in Health.");
  await act(async () => { view!.unmount(); });
});
it("preserves local watch HR when ordinary synced history is pruned", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ request: { client_session_id: String(i) }, state: "synced", watch: i === 24 ? { parts: [] } : undefined }));
  expect(pruneHistory(items as Parameters<typeof pruneHistory>[0]).some(h => h.request.client_session_id === "24")).toBe(true);
});

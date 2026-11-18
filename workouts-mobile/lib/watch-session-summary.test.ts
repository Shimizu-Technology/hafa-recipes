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
  const items = Array.from({ length: 25 }, (_, i) => ({ request: { client_session_id: String(i), started_at: new Date().toISOString() }, state: "synced", watch: i === 24 ? { parts: [] } : undefined }));
  expect(pruneHistory(items as Parameters<typeof pruneHistory>[0]).some(h => h.request.client_session_id === "24")).toBe(true);
});

it("caps full watch history by count and age, keeps small HR summaries in short history, and preserves unsynced results", () => {
  const now = Date.parse("2026-11-17T00:00:00Z");
  const recent = Array.from({ length: 85 }, (_, i) => ({ state: "synced", request: { client_session_id: String(i), started_at: new Date(now - i * 60000).toISOString() },
    watch: { heart_rate: { average: 145 }, parts: [{ block_id: "a" }] } }));
  const cast = (items: unknown) => items as Parameters<typeof pruneHistory>[0];
  const pruned = pruneHistory(cast(recent), now);
  expect(pruned.filter(h => h.watch?.parts.length)).toHaveLength(60);
  expect(pruned).toHaveLength(80); expect(pruned[60].watch).toEqual({ heart_rate: { average: 145 }, parts: [] });
  const old = recent.map(h => ({ ...h, request: { ...h.request, started_at: "2026-01-01T00:00:00Z" } }));
  const aged = pruneHistory(cast(old), now);
  expect(aged).toHaveLength(20); expect(aged.every(h => h.watch?.parts.length === 0)).toBe(true);
  const queued = { ...old[0], state: "queued" }, blocked = { ...old[1], state: "blocked" }, scores = { ...old[2], unsent_results: { reason: "local scores" } };
  expect(pruneHistory(cast([...recent, queued, blocked, scores]), now).slice(-3)).toEqual([queued, blocked, scores]);
});

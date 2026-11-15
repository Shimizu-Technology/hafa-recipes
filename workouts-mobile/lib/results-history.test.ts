import { describe, expect, it, vi } from "vitest";
import { createWorkoutsApi } from "./api";
import { benchmarkProgressions, resultsByPart, scoreFromSortValue, type BenchmarkGroup, type ResultRow } from "./results-history";

/** Rows as the API returns them for the Nov 17 class and a later repeat (Everest progression 2). */
function row(id: string, label: string, day: string, rounds: number, reps: number, scaling: ResultRow["scaling"]): ResultRow {
  return { id, session_id: `s-${id}`, block_id: label.toLowerCase(), block_label: label, comparison_key: `benchmark:everest:2:${label}`,
    benchmark_key: "everest", source_workout_id: "w", kind: "rounds_reps", scaling, sort_value: rounds * 10001 + reps, better: "higher",
    performed_at: `2026-${day}T18:00:00Z`, result: { block_id: label.toLowerCase(), kind: "rounds_reps", rounds, reps, scaling: scaling ?? undefined, origin: "timer" } };
}

describe("scores from the API's ranking value", () => {
  it("inverts every kind the server ranks", () => {
    expect(scoreFromSortValue("rounds_reps", 3 * 10001 + 12)).toBe("3 + 12");
    expect(scoreFromSortValue("rounds_reps", 900 - 1000001)).toBe("Buy-in · 900 m");
    expect(scoreFromSortValue("time", 522)).toBe("8:42");
    expect(scoreFromSortValue("time", 1e12 - (2 * 10001 + 14))).toBe("Capped · 2 + 14");
    expect(scoreFromSortValue("load", 100)).toBe("100 kg");
    expect(scoreFromSortValue("load", 100 * 0.45359237, "imperial")).toBe("100 lb");
    expect(scoreFromSortValue("completed", 1)).toBe("Done");
  });
});

describe("your results for a workout", () => {
  it("groups by part, newest first, marking the best per Rx/Scaled and a score that beat every earlier one", () => {
    const rows = [row("3", "A", "11-24", 3, 5, "rx"), row("2", "B", "11-17", 2, 40, "scaled"), row("1", "A", "11-17", 2, 12, "rx"), row("4", "A", "12-01", 3, 0, "scaled")];
    const parts = resultsByPart(rows);
    expect(parts.map((p) => p.label)).toEqual(["A", "B"]);
    expect(parts[0].items.map((r) => [r.id, r.best, r.pr])).toEqual([["4", false, false], ["3", true, true], ["1", false, false]]);
    // One score alone in its group isn't called a best.
    expect(parts[1].items[0]).toMatchObject({ best: false, pr: false });
  });
});

describe("benchmark progressions", () => {
  it("orders each benchmark's stages and parts", () => {
    const group = (stage: number | null, label: string, scaling: BenchmarkGroup["scaling"]): BenchmarkGroup => ({ benchmark_key: "everest", stage,
      block_label: label, comparison_key: `benchmark:everest:${stage ?? 0}:${label}`, kind: "rounds_reps", scaling });
    const [everest] = benchmarkProgressions([group(3, "A", "rx"), group(2, "B", "rx"), group(2, "A", "scaled"), group(2, "A", "rx")]);
    expect(everest.name).toBe("Everest");
    expect(everest.stages.map((s) => [s.stage, s.parts.map((p) => `${p.block_label} ${p.scaling}`)]))
      .toEqual([[2, ["A rx", "A scaled", "B rx"]], [3, ["A rx"]]]);
  });
});

describe("API calls", () => {
  it("reads results and benchmarks, and changes heart-rate summaries with the account generation", async () => {
    const transport = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(
      url.endsWith("/enrollment") ? { enrolled: true, generation: 4, disclosure_version: 1, adult_confirmed: true, shared_account_deletion_acknowledged: true, enrolled_at: null }
        : init.method === "DELETE" ? { enabled: false, deleted_sessions: 3 } : url.includes("/results") ? { items: [], history_limited: false } : [])));
    const api = createWorkoutsApi("https://example.test", async () => "token", transport as unknown as typeof fetch);
    await api.enrollment();
    await api.results({ workout_id: "w1" });
    await api.results({ benchmark_key: "everest" });
    await api.benchmarks();
    await api.setHeartRateSummaries(true);
    expect(await api.deleteHeartRateSummaries()).toEqual({ enabled: false, deleted_sessions: 3 });
    const calls = transport.mock.calls.slice(1).map(([url, init]) => [init.method, url.replace("https://example.test/api/v1/workouts", ""),
      (init.headers as Record<string, string>)["X-Workouts-Generation"] ?? null, init.body ?? null]);
    expect(calls).toEqual([
      ["GET", "/results?limit=50&workout_id=w1", null, null],
      ["GET", "/results?limit=50&benchmark_key=everest", null, null],
      ["GET", "/benchmarks", null, null],
      ["PUT", "/health-summary-consent", "4", JSON.stringify({ enabled: true })],
      ["DELETE", "/health-summary-consent", "4", null],
    ]);
  });
});

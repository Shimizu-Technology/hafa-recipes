import { formatPartScore, type PartResult } from "./class-session";
import type { UnitSystem } from "./training";

/** Results history (API W3): one row per scored part of a saved session, corrections already folded in. */
export interface ResultColumns {
  id: string; session_id: string; block_id: string; block_label: string; comparison_key: string;
  benchmark_key: string | null; source_workout_id: string | null; kind: PartResult["kind"];
  scaling: "rx" | "scaled" | "custom" | null; sort_value: number; better: "lower" | "higher"; performed_at: string;
}
export interface ResultRow extends ResultColumns { result: PartResult }
export interface ResultsPage { items: ResultRow[]; history_limited: boolean }
/** Best and last for one benchmark part, stage, score kind and scaling. */
export interface BenchmarkGroup {
  benchmark_key: string; stage: number | null; block_label: string; comparison_key: string;
  kind: PartResult["kind"]; scaling: ResultColumns["scaling"]; last?: ResultColumns; best?: ResultColumns;
}

export const scalingLabel = (scaling: ResultColumns["scaling"]) =>
  scaling === "rx" ? "Rx" : scaling === "scaled" ? "Scaled" : scaling === "custom" ? "Custom" : "Rx or scaled not set";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/**
 * A score from its ranking value alone, for benchmark best/last rows, which carry no result. Inverts the API's
 * `sort_value`: rounds × 10001 + reps; a cap is 1e12 minus that; an unfinished buy-in is metres − 1000001;
 * load is kg.
 */
export function scoreFromSortValue(kind: PartResult["kind"], value: number, units: UnitSystem = "metric") {
  switch (kind) {
    case "rounds_reps":
      return value < 0 ? `Buy-in · ${Math.round(value + 1000001)} m` : `${Math.floor(value / 10001)} + ${Math.round(value % 10001)}`;
    case "time": {
      if (value <= 86400) return clock(value);
      const rr = Math.round(1e12 - value);
      return `Capped · ${Math.floor(rr / 10001)} + ${rr % 10001}`;
    }
    case "load": return units === "imperial" ? `${Math.round(value / 0.45359237)} lb` : `${Math.round(value * 10) / 10} kg`;
    case "reps": return `${value} reps`;
    case "distance": return `${value} m`;
    case "calories": return `${value} cal`;
    default: return "Done";
  }
}
export const rowScore = (row: ResultRow) => formatPartScore(row.result);
const better = (a: ResultColumns, b: ResultColumns) => (a.better === "lower" ? a.sort_value < b.sort_value : a.sort_value > b.sort_value);
const group = (row: ResultColumns) => `${row.comparison_key}|${row.kind}|${row.scaling ?? ""}`;

/**
 * One workout's results by part (A, B…), newest first. `best` marks the best score among results scored the same
 * way (same part, score kind and Rx/Scaled), and `pr` a result that beat every earlier one.
 */
export function resultsByPart(rows: readonly ResultRow[]) {
  const parts = new Map<string, Array<ResultRow & { best: boolean; pr: boolean }>>();
  const bestOf = new Map<string, ResultRow>();
  for (const row of rows) if (!bestOf.has(group(row)) || better(row, bestOf.get(group(row))!)) bestOf.set(group(row), row);
  const sizes = new Map<string, number>();
  for (const row of rows) sizes.set(group(row), (sizes.get(group(row)) ?? 0) + 1);
  for (const row of rows) {
    const earlier = rows.filter((r) => group(r) === group(row) && r.performed_at < row.performed_at);
    const list = parts.get(row.block_label) ?? [];
    list.push({ ...row, best: sizes.get(group(row))! > 1 && bestOf.get(group(row))!.id === row.id,
      pr: earlier.length > 0 && earlier.every((r) => better(row, r)) });
    parts.set(row.block_label, list);
  }
  return [...parts.entries()].map(([label, items]) => ({ label, items: items.sort((a, b) => b.performed_at.localeCompare(a.performed_at)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Benchmarks with each progression in order: "Everest" → stage 1, 2, 3 → A Rx, A Scaled, B Rx… */
export function benchmarkProgressions(groups: readonly BenchmarkGroup[]) {
  const byKey = new Map<string, BenchmarkGroup[]>();
  for (const g of groups) byKey.set(g.benchmark_key, [...(byKey.get(g.benchmark_key) ?? []), g]);
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => ({
    key, name: benchmarkName(key),
    stages: [...new Set(list.map((g) => g.stage ?? 0))].sort((a, b) => a - b).map((stage) => ({
      stage: stage || null,
      parts: list.filter((g) => (g.stage ?? 0) === stage)
        .sort((a, b) => a.block_label.localeCompare(b.block_label) || (a.scaling ?? "").localeCompare(b.scaling ?? "")),
    })),
  }));
}
/** "everest" → "Everest", "hyrox-sim" → "Hyrox sim". The key is the server's slug of the benchmark's name. */
export function benchmarkName(key: string) {
  const words = key.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

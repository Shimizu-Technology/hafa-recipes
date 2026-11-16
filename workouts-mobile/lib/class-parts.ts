import type { ExercisePrescription, Workout } from "./models";
import type { UnitSystem } from "./training";
import { formatSeconds } from "./discover";

type Block = Workout["blocks"][number];
const roleLabels = { warm_up: "Warm-up", main: null, accessory: "Accessory", cool_down: "Cool-down" } as const;

/** A suggested weight for a %-bodyweight load, from the profile weight: "≈ 64 kg (75% of 85 kg)". */
export function relativeLoadSuggestion(e: Pick<ExercisePrescription, "relative_load">, weightKg: number | null | undefined, units: UnitSystem) {
  if (e.relative_load?.basis !== "bodyweight" || weightKg == null || !(weightKg > 0)) return null;
  const toUnit = (kg: number) => (units === "imperial" ? kg * 2.20462 : kg);
  const unit = units === "imperial" ? "lb" : "kg";
  const suggested = Math.round(toUnit(weightKg) * e.relative_load.percent / 100);
  return `≈ ${suggested} ${unit} (${e.relative_load.percent}% of ${Math.round(toUnit(weightKg))} ${unit})`;
}
export function segmentLabel(e: Pick<ExercisePrescription, "segment">) {
  return e.segment === "buy_in" ? "Buy-in, once" : e.segment === "cash_out" ? "Cash-out, once" : null;
}
/** The part's role and scoring, when they differ from an ordinary scored part. */
export function partTags(block: Block) {
  return [block.role ? roleLabels[block.role] : null, block.score_kind === "none" ? "Not scored" : null].filter(Boolean) as string[];
}
export function restAfterText(block: Block) {
  return block.rest_after_seconds ? `Rest ${formatSeconds(block.rest_after_seconds)}` : null;
}
/** "Unified · BUILD | BRIK · HYBRID · Tue, Nov 17". */
export function programmingLine(workout: Pick<Workout, "programming">) {
  const p = workout.programming;
  if (!p) return null;
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
    ? new Date(`${p.date}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : null;
  return [p.gym_name, p.track, p.track_variant, date].filter(Boolean).join(" · ") || null;
}
/** "Benchmark · Everest · progression 2 of 3". */
export function benchmarkLine(workout: Pick<Workout, "benchmark">) {
  const b = workout.benchmark;
  if (!b) return null;
  const stage = b.stage != null ? `progression ${b.stage}${b.stages != null ? ` of ${b.stages}` : ""}` : null;
  return ["Benchmark", b.name, stage].filter(Boolean).join(" · ");
}
/** Coach notes, rather than generic instructions, for a class from a gym or coach. */
export const instructionsTitle = (workout: Pick<Workout, "programming">) =>
  workout.programming && workout.programming.source_kind !== "self" ? "Coach notes" : "Workout instructions";

/** Keep numeric prescriptions together when accessibility text wraps. Display only. */
export function keepPrescriptionTokens(text: string) {
  return text.replace(/(\d)\s*([/–-])\s*(?=\d)/g, "$1\u2060$2\u2060")
    .replace(/(\d) +(?=(?:kg|lbs?|reps?|m|km|s|min|seconds?|minutes?)\b)/g, "$1\u00a0");
}

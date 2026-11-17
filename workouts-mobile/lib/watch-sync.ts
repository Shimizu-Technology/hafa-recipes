import type { ActualSet, Program, SessionRequest, Workout } from "./models";
import { dateInTimezone, stepsFor, actualIdentity, actualErrors, type SavedLocalSession, type SessionSource, type TrainingState } from "./training";
import { isRun, partKind, type PartResult, type Segment } from "./class-session";
import { inferActivityType } from "./training-view";
import { moveText, repsFor } from "./timed-execution";

export interface WatchPlan {
  plan_key: string; title: string; date?: string; activity_type: number; runs_outside: boolean;
  source?: SessionSource; account_key: string; lead_in_seconds: number;
  parts: Array<{ block_id: string; label: string; kind: string; scored: boolean; [key: string]: unknown }>;
}
const sourceKey = (source: SessionSource) => "workout_id" in source ? source.workout_id : `${source.program_id}:${source.program_session_id}`;
export const watchAccountKey = (owner: string, generation: number) => `${owner}:${generation}`;
export function watchPlan(workout: Workout, source: SessionSource, account: string, date?: string, activity?: string): WatchPlan {
  const plan: WatchPlan = { plan_key: JSON.stringify([source, date ?? null]), title: workout.title, date, source,
    activity_type: ({ cross_training: 11, hiit: 63, functional_strength: 20, strength_training: 50, running: 37, walking: 52, basketball: 6, general_fitness: 3000 } as Record<string, number>)[activity ?? inferActivityType(workout)] ?? 11, runs_outside: false, account_key: account, lead_in_seconds: 3,
    parts: workout.blocks.map(b => ({ block_id: b.id, label: b.label, role: b.role, kind: partKind(b),
      ...(b.execution?.mode === "amrap" ? { cap_seconds: b.execution.time_cap_seconds } :
        b.execution?.mode === "for_time" ? { cap_seconds: b.execution.time_cap_seconds } :
        b.execution?.mode === "emom" ? { interval_seconds: b.execution.interval_seconds, intervals: b.execution.intervals } :
        b.execution?.mode === "work_rest" ? { work_seconds: b.execution.work_seconds, rest_seconds: b.execution.rest_seconds, rounds: b.execution.intervals } : { rounds: b.rounds }),
      actuals: (() => {
        if (["emom", "work_rest"].includes(partKind(b))) return []; // Clock passage never claims performed reps.
        const templates = partKind(b) === "sets" ? stepsFor({ ...workout, blocks: [b] }) :
          stepsFor({ ...workout, blocks: [{ ...b, execution: undefined, rounds: 1 }] });
        return templates.map(s => ({ block_id: b.id, exercise_index: s.exercise_index, round_index: s.round_index, set_index: s.set_index,
          side: s.side, completed: true, reps: repsFor(s.exercise, s.round_index), rep_scheme: s.exercise.rep_scheme,
          ladder_start: s.exercise.ladder?.start, ladder_step: s.exercise.ladder?.step, ladder_end: s.exercise.ladder?.end,
          duration_seconds: s.exercise.duration_seconds, distance_meters: s.exercise.distance_meters,
          ...(s.exercise.load != null && s.exercise.load_unit ? { load: s.exercise.load, load_unit: s.exercise.load_unit, load_convention: s.exercise.load_convention ?? "total" } : {}) }));
      })(),
      rest_after_seconds: b.rest_after_seconds, scored: b.score_kind !== "none" && ["amrap", "for_time"].includes(partKind(b)),
      moves: b.exercises.map((e, index) => ({ index, text: moveText(e, 1), segment: e.segment, is_run: isRun(e), distance_m: e.distance_meters })) })) };
  // The engine advances one movement per tap. Flatten sets in the phone's exact order.
  plan.parts.forEach((part, i) => {
    const block = workout.blocks[i];
    if (part.kind !== "sets") return;
    const cells = stepsFor({ ...workout, blocks: [block] }).filter(s => s.side !== "right");
    if (block.rounds != null || block.exercises.some(e => e.sets != null)) {
      part.rounds = 1;
      part.moves = cells.map((s, index) => ({ index, text: moveText(s.exercise, s.round_index), is_run: isRun(s.exercise), distance_m: s.exercise.distance_meters }));
    }
  });
  return plan;
}
export function planContext(options: { account: string; units: string; today: string; programs: Program[];
  library: Workout[]; state: TrainingState; leadIn: number }) {
  const next = new Date(`${options.today}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 2);
  const through = next.toISOString().slice(0, 10);
  const entries: Array<{ plan: WatchPlan; workout: Workout }> = [];
  const add = (workout: Workout, source: SessionSource, date?: string, activity?: string) => {
    let plan: WatchPlan;
    try { plan = watchPlan(workout, source, options.account, date, activity); } catch { return; }
    plan.lead_in_seconds = options.leadIn;
    if (!entries.some(e => e.plan.plan_key === plan.plan_key)) entries.push({ plan, workout });
  };
  for (const p of options.programs) if (p.status === "ready" && !p.schedule_state?.archived_at && p.schedule_state?.status !== "paused")
    for (const s of p.sessions) if (s.date >= options.today && s.date <= through)
      add(s.workout, { program_id: p.id, program_revision: p.revision, program_session_id: s.id }, s.date);
  for (const w of options.library) if (w.programming?.date && w.programming.date >= options.today && w.programming.date <= through)
    add(w, { workout_id: w.id, workout_revision: w.revision }, w.programming.date);
  entries.sort((a, b) => (a.plan.date ?? "").localeCompare(b.plan.date ?? ""));
  const recent = [...(options.state.active ? [options.state.active] : []), ...options.state.history.map(h => ({ ...h.request, workout: h.workout, source: sourceOf(h.request) }))]
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const used = new Set(entries.flatMap(e => e.plan.source ? [sourceKey(e.plan.source)] : []));
  let recentCount = 0;
  for (const s of recent) {
    const key = sourceKey(s.source);
    if (s.workout.blocks.some(b => b.id === "timer" && b.exercises.some(e => e.name === "Open timer")) ||
      options.state.history.some(h => h.watch_quick && h.request.client_session_id === ("id" in s ? s.id : s.client_session_id))) continue;
    if (!used.has(key) && recentCount < 5) { used.add(key); recentCount++; add(s.workout, s.source, undefined, s.activity_type ?? undefined); }
  }
  const context = { v: 1, generated_at: new Date().toISOString(), account_key: options.account, units: options.units,
    lead_in_seconds: options.leadIn, plans: [] as WatchPlan[] };
  const catalog: Record<string, Workout> = {};
  for (const e of entries) {
    context.plans.push(e.plan);
    if (new TextEncoder().encode(JSON.stringify(context)).length >= 16 * 1024) { context.plans.pop(); continue; }
    catalog[e.plan.plan_key] = e.workout;
  }
  return { json: JSON.stringify(context), catalog };
}
export function sourceOf(s: SessionRequest): SessionSource {
  if (s.workout_id && s.workout_revision) return { workout_id: s.workout_id, workout_revision: s.workout_revision };
  return { program_id: s.program_id!, program_revision: s.program_revision!, program_session_id: s.program_session_id! };
}
type HR = { average?: number; max?: number };
export interface WatchResult {
  v: 1; recorded_on: "watch"; client_session_id: string; plan_key: string; plan?: WatchPlan;
  started_at: string; finished_at: string; health_workout_uuid?: string; heart_rate?: HR;
  active_intervals: NonNullable<SessionRequest["active_intervals"]>;
  parts: Array<{ block_id: string; start?: string; end?: string; active_seconds: number; rounds: number;
    buy_in_done_at?: string; skipped: boolean; heart_rate?: HR;
    score?: { rounds: number; reps: number; seconds: number; scaled: boolean } }>;
  status?: "completed" | "partial";
  actuals: ActualSet[]; results: PartResult[];
  segments: Segment[];
}
export interface WatchDetails { heart_rate?: HR; parts: WatchResult["parts"]; duplicate_phone_id?: string }
/** Reconstruct doses from the exact snapshot sent to the watch, never a newly edited prescription. */
export function watchSession(r: WatchResult, workout: Workout, generation: number, state: TrainingState): SavedLocalSession {
  const source = r.plan?.source ?? { workout_id: workout.id, workout_revision: workout.revision };
  const actuals = r.actuals, results = r.results, segments = r.segments;
  const cells = new Set<string>();
  if (!actuals || !results || actuals.length > 1000 || actuals.some(a => {
    const block = workout.blocks.find(b => b.id === a.block_id), exercise = block?.exercises[a.exercise_index];
    const key = actualIdentity(a), duplicate = cells.has(key); cells.add(key);
    return duplicate || !block || !exercise || !Number.isInteger(a.exercise_index) ||
      !Number.isInteger(a.round_index) || a.round_index < 1 || a.round_index > 100 ||
      !Number.isInteger(a.set_index) || a.set_index < 1 || a.set_index > (exercise.sets ?? 1) ||
      (exercise.segment === "buy_in" && a.round_index !== 1) ||
      (exercise.per_side ? a.side !== "left" && a.side !== "right" : a.side != null && a.side !== "both") ||
      typeof a.completed !== "boolean" || actualErrors(a).length > 0;
  }) || results.some(result => !workout.blocks.some(b => b.id === result.block_id)) ||
    segments.some(segment => !workout.blocks.some(b => b.id === segment.block_id)))
    throw Error("Watch actuals do not match their pinned workout.");
  const intervals = r.active_intervals;
  const start = Date.parse(r.started_at), end = Date.parse(r.finished_at);
  let previous = start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || intervals.length > 100 ||
    intervals.some(i => {
      const from = Date.parse(i.started_at), until = Date.parse(i.ended_at);
      const invalid = !Number.isFinite(from) || !Number.isFinite(until) || from < previous || until <= from || until > end;
      previous = until; return invalid;
    })) throw Error("Invalid watch session time.");
  const active = intervals.reduce((n, i) => n + (Date.parse(i.ended_at) - Date.parse(i.started_at)) / 1000, 0);
  if (active <= 0 || active > 86400) throw Error("Invalid watch session time.");
  const request: SessionRequest = { client_session_id: r.client_session_id.toLowerCase(), ...source,
    started_at: r.started_at, finished_at: r.finished_at, status: r.status ?? (r.parts.some(p => p.skipped || !p.end) ? "partial" : "completed"),
    active_seconds: Math.floor(active), active_intervals: intervals, activity_type: ({ 11: "cross_training", 63: "hiit", 20: "functional_strength", 37: "running", 52: "walking", 50: "strength_training", 6: "basketball", 3000: "general_fitness" } as Record<number, string>)[r.plan?.activity_type ?? 11] ?? "general_fitness",
    actuals, results, segments, recorded_on: "watch", ...(r.health_workout_uuid ? { apple_workout_uuid: r.health_workout_uuid } : {}) };
  // HR is deliberately outside SessionRequest: it never reaches saveSession or recovery payloads.
  const duplicate = state.active && sourceKey(state.active.source) === sourceKey(source) ? state.active.id : undefined;
  return { request, workout, generation, state: "queued", cell_identity_version: 2, timed_format: true,
    watch: { heart_rate: r.heart_rate, parts: r.parts, duplicate_phone_id: duplicate } };
}
export function quickWorkout(r: WatchResult, generation: number): Workout {
  const minutes = Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 60000);
  return { id: r.client_session_id, revision: 1, generation, title: `${r.plan?.title === "Open timer" ? `Open timer ${minutes} min` : r.plan?.title ?? "Open timer"} · watch, ${new Date(r.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    kind: "session", provenance: "user", blocks: [{ id: "timer", label: "Open timer", grouping: "circuit", score_kind: "none",
      execution: { mode: "amrap", time_cap_seconds: Math.max(1, Math.floor((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)) },
      exercises: [{ name: "Open timer", duration_seconds: Math.max(1, Math.floor((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)) }] }] };
}
export interface WatchAttention { id: string; title: string; reason: string; discardable: boolean }
export type WatchCatalog = Record<string, Workout & { watch_cached_at?: number }>;
export function pruneWatchCatalog(prior: WatchCatalog, sent: Record<string, Workout>, pending: string[], now = Date.now()): WatchCatalog {
  const keys = new Set(pending.flatMap(raw => { try { return [JSON.parse(raw).plan_key]; } catch { return []; } }));
  const catalog: WatchCatalog = {};
  for (const [key, workout] of Object.entries(prior)) {
    // Pre-timestamp catalogs get one migration grace period.
    const cached = workout.watch_cached_at ?? now;
    if (keys.has(key) || cached >= now - 45 * 86400000) catalog[key] = { ...workout, watch_cached_at: cached };
  }
  for (const [key, workout] of Object.entries(sent)) {
    const { watch_cached_at: cached, ...snapshot } = prior[key] ?? {};
    // Keep the original timestamp for unchanged snapshots; timestamp-only churn is not a catalog change.
    const unchanged = JSON.stringify(snapshot) === JSON.stringify(workout);
    catalog[key] = { ...workout, watch_cached_at: unchanged && cached != null ? cached : now };
  }
  return catalog;
}
export function stablePlans(json: string): string { const { generated_at: _, ...context } = JSON.parse(json); return JSON.stringify(context); }
export function watchCollisions(state: TrainingState, today: string, timezone: string) {
  return state.history.filter(h => h.watch?.duplicate_phone_id && dateInTimezone(new Date(h.request.started_at), timezone) === today &&
    (state.active?.id === h.watch.duplicate_phone_id || state.history.some(p => p.request.client_session_id === h.watch?.duplicate_phone_id)));
}
export async function drainWatch(options: { pendingResults(): Promise<string[]>; markImported(id: string): Promise<void>;
  current(): boolean; account: string; generation: number; catalog: Record<string, Workout>;
  store: { snapshot(): TrainingState; importWatch(item: SavedLocalSession): Promise<void> } }): Promise<WatchAttention[]> {
  const attention: WatchAttention[] = [];
  for (const raw of await options.pendingResults()) {
    if (!options.current()) return attention;
    let r: WatchResult | undefined;
    let permanent = false;
    try {
      r = JSON.parse(raw) as WatchResult;
      if (r?.v !== 1 || r.recorded_on !== "watch") { permanent = true; throw Error("This watch result uses an unsupported format."); }
      if (!r.plan?.account_key) { permanent = true; throw Error("This timer has no account. It cannot be assigned safely. Discard it and open Håfa on your phone before starting again."); }
      if (r.plan.account_key !== options.account) {
        const owner = options.account.slice(0, options.account.lastIndexOf(":"));
        const priorOwner = r.plan.account_key.slice(0, r.plan.account_key.lastIndexOf(":"));
        permanent = owner === priorOwner;
        throw Error(permanent ? "This result belongs to an earlier training setup and cannot be imported into this one."
          : "This result belongs to another account. Sign in to its original account to import it.");
      }
      const state = options.store.snapshot();
      if (!state.watch_imported?.includes(r.client_session_id.toLowerCase())) {
        const workout = r.plan.source ? options.catalog[r.plan_key] : quickWorkout(r, options.generation);
        if (!workout) throw Error("The saved class snapshot is missing. Keep this result while restoring this phone's training data.");
        let item: SavedLocalSession;
        try { item = watchSession(r, workout, options.generation, state); }
        catch (error) { permanent = true; throw error; }
        if (!r.plan.source) item.watch_quick = true;
        if (!options.current()) return attention;
        await options.store.importWatch(item);
      }
      if (options.current()) await options.markImported(r.client_session_id);
    } catch (error) {
      const id = typeof r?.client_session_id === "string" ? r.client_session_id : "";
      attention.push({ id, title: r?.plan?.account_key === options.account ? r.plan.title : "Watch result",
        reason: error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : "This result could not be validated. Keep it for recovery.",
        discardable: permanent && (!r?.plan?.account_key || typeof r.plan.account_key === "string" &&
          r.plan.account_key.slice(0, r.plan.account_key.lastIndexOf(":")) === options.account.slice(0, options.account.lastIndexOf(":"))) && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) });
    }
  }
  return attention;
}

import { aiUnavailableMessage, dailyAiLimitMessage, importFinished, sourceRefusalMessages } from "./import-status";
import { addMutation, withoutRefusedRetry } from "./outbox";
import type { BabyRecord, DeviceState, ImportJob, Mutation } from "./models";

/**
 * "Organize everything waiting": one tap reads every saved post that was never organized, a few at a time.
 *
 * Each post goes through the same `POST /imports` as "Read with AI" on its own page, so the API's limits (five
 * waiting, thirty a day, the AI spending window) still decide. This only paces what it hands the outbox, and
 * stops at a limit instead of filling the outbox with refusals.
 */
export interface OrganizeRun {
  started_at: string;
  total: number;
  /** Not handed to the outbox yet, oldest saved first. */
  waiting: OrganizeItem[];
  /** In the outbox or processing: which import is reading which post. */
  active: { record_id: string; import_id: string }[];
  organized: number;
  /** Posts that couldn't be read this time. Each keeps its original, and its own page offers Try again. */
  attention: string[];
  /** Why it stopped before the end. A limit means the rest wait for tomorrow. */
  stopped?: "limit" | "ai_off" | "cancelled";
  /** Another phone or share filled the API's queue: wait a little before handing over more. */
  paused_until?: string;
  finished_at?: string;
}
export interface OrganizeItem {
  record_id: string;
  space_id?: string;
  child_id: string | null;
  topics: string[];
}

/** At most this many of hers are being read at once, out of the API's five, so a new share still has room. */
export const organizeAtOnce = 3;
const pauseMs = 2 * 60_000;
const waitingStatuses = ["saved", "failed"];

const importFor = (state: Pick<DeviceState, "outbox" | "imports">, id: string) =>
  state.outbox.some((m) => m.type === "import" && m.record_id === id && !m.error) ||
  state.imports.some((job) => job.record_id === id && !importFinished(job.status));

/** Saved but never organized (automatic organizing was off), or a read that failed. Anything already on its way isn't. */
export function waitingSource(record: BabyRecord, state: Pick<DeviceState, "outbox" | "imports">) {
  const data = record.data;
  if (record.kind !== "source" || record.cache_partial || !waitingStatuses.includes(data.status ?? "")) return false;
  const material = !!(data.url || data.attachment_ids?.length || record.body.trim() || data.source_text?.trim());
  return material && !importFor(state, record.id);
}

/** Every saved post, a page at a time, up to 500. */
export async function findWaiting(list: (offset: number) => Promise<{ items: BabyRecord[]; has_more: boolean }>,
  state: Pick<DeviceState, "outbox" | "imports">) {
  const rows: BabyRecord[] = [];
  for (let offset = 0, page = 0; page < 5; page++, offset += 100) {
    const result = await list(offset);
    rows.push(...result.items);
    if (!result.has_more) break;
  }
  return rows.filter((row) => waitingSource(row, state)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export function startOrganize(state: DeviceState, rows: BabyRecord[], now = new Date()): DeviceState {
  if (state.organizeRun && !state.organizeRun.finished_at) return state;
  const fresh = rows.filter((row) => waitingSource(row, state));
  if (!fresh.length) return state;
  // Each post is on this phone while it's read, so its page and the outbox know which space it's in.
  const records = fresh.reduce((all, row) => [row, ...all.filter((r) => r.id !== row.id)], state.records)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return { ...state, records, organizeRun: {
    started_at: now.toISOString(), total: fresh.length, organized: 0, attention: [], active: [],
    waiting: fresh.map((row) => ({ record_id: row.id, space_id: row.space_id, child_id: row.child_id ?? null, topics: row.data.topics ?? [] })),
  } };
}

const limitMessages = [sourceRefusalMessages.source_daily_limit, dailyAiLimitMessage];
/** The API finishes a job it couldn't read with AI as incomplete, with one of these: the rest would only do the same. */
const stopMessages = [dailyAiLimitMessage, aiUnavailableMessage];

/** One pass: settle what finished, then hand the outbox what fits. Returns the same state when nothing changed. */
export function advanceOrganize(state: DeviceState, uuid: () => string, now = new Date()): DeviceState {
  const run = state.organizeRun;
  if (!run || run.finished_at) return state;
  let next = state, changed = false;
  const active: OrganizeRun["active"] = [], back: OrganizeItem[] = [], attention = [...run.attention];
  let organized = run.organized, total = run.total, stopped = run.stopped, paused_until = run.paused_until;
  const itemFor = (id: string): OrganizeItem => {
    const row = state.records.find((r) => r.id === id);
    return { record_id: id, space_id: row?.space_id, child_id: row?.child_id ?? null, topics: row?.data.topics ?? [] };
  };
  for (const item of run.active) {
    const queued = next.outbox.find((m) => m.id === item.import_id);
    if (queued) {
      if (!queued.error) { active.push(item); continue; }
      // Refused before it started: nothing was read or charged. Take it out of the outbox, then decide.
      next = withoutRefusedRetry(next, queued.id);
      changed = true;
      if (limitMessages.includes(queued.error)) { stopped = "limit"; back.push(itemFor(item.record_id)); }
      else if (queued.error === sourceRefusalMessages.source_already_processing) organized++; // Another phone has it.
      else if (queued.error === sourceRefusalMessages.source_queue_full) {
        paused_until = new Date(now.getTime() + pauseMs).toISOString(); back.push(itemFor(item.record_id));
      } else attention.push(item.record_id);
      continue;
    }
    const job: ImportJob | undefined = next.imports.find((one) => one.id === item.import_id);
    if (job && !importFinished(job.status)) { active.push(item); continue; }
    changed = true;
    if (!job) attention.push(item.record_id); // Discarded from Sync & recovery.
    else if (job.error && stopMessages.includes(job.error)) {
      stopped = job.error === dailyAiLimitMessage ? "limit" : "ai_off"; back.push(itemFor(item.record_id));
    }
    else if (["ready", "complete", "completed"].includes(job.status) || (job.status === "incomplete" && !job.error)) organized++;
    else attention.push(item.record_id);
  }
  let waiting = [...back, ...run.waiting];
  if (paused_until && new Date(paused_until) <= now) { paused_until = undefined; changed = true; }
  // AI switched off, or the service down, since she started: nothing more goes until she starts again.
  if (!stopped && !(next.bootstrap?.ai_available && next.bootstrap.profile?.ai_consent)) { stopped = "ai_off"; changed = true; }
  if (!stopped && !paused_until) {
    const ours = new Set(active.map((item) => item.record_id)),
      others = next.outbox.filter((m) => m.type === "import" && !m.error && !ours.has(m.record_id ?? "")).length +
        next.imports.filter((job) => !importFinished(job.status) && !ours.has(job.record_id ?? "")).length;
    while (waiting.length && active.length + others < organizeAtOnce && next.bootstrap) {
      const item = waiting[0];
      waiting = waiting.slice(1);
      changed = true;
      // Started from its own page or another phone since: it's on its way already, so it isn't this run's.
      if (importFor(next, item.record_id)) { organized++; continue; }
      // Organized elsewhere or removed since the list was read: leave it be, and don't count it.
      const row = next.records.find((r) => r.id === item.record_id);
      if (!row || !waitingSource(row, next)) { total--; continue; }
      const import_id = uuid();
      const change: Mutation = { id: import_id, generation: next.bootstrap.generation, type: "import", record_id: item.record_id,
        ...(item.space_id ? { space_id: item.space_id } : {}), files: [], child_id: item.child_id, topics: item.topics };
      next = addMutation(next, change);
      active.push({ record_id: item.record_id, import_id });
    }
  }
  if (!changed) return state;
  const done = !active.length && (!waiting.length || !!stopped);
  return { ...next, organizeRun: { ...run, total, active, waiting, organized, attention, stopped, paused_until,
    ...(done ? { finished_at: now.toISOString() } : {}) } };
}

/** Stop handing over more. What's already reading finishes; the rest stay saved, as they were. */
export function stopOrganize(state: DeviceState, now = new Date()): DeviceState {
  const run = state.organizeRun;
  if (!run || run.finished_at) return state;
  return { ...state, organizeRun: { ...run, stopped: "cancelled", ...(run.active.length ? {} : { finished_at: now.toISOString() }) } };
}
/**
 * After a daily limit, when it can start again. The API counts the last 24 hours, so a day after the limit is the
 * latest that could be: one of the reads that filled it has passed by then.
 */
export const organizeAgainAt = (run: OrganizeRun | undefined) =>
  run?.stopped === "limit" && run.finished_at ? new Date(new Date(run.finished_at).getTime() + 24 * 3600_000).toISOString() : undefined;
/** Dismissed. After a limit, "Organize all" waits until it could work rather than offering a tap that's refused. */
export function clearOrganize(state: DeviceState): DeviceState {
  const { organizeRun: run, ...rest } = state, again = organizeAgainAt(run);
  return again ? { ...rest, organizeHeldUntil: again } : rest;
}
/** Whether "Organize all" is held back for the daily limit at this moment. */
export const organizeHeld = (state: Pick<DeviceState, "organizeHeldUntil">, now = new Date()) =>
  !!state.organizeHeldUntil && new Date(state.organizeHeldUntil) > now;

const posts = (n: number) => `${n} saved post${n === 1 ? "" : "s"}`;
/**
 * The words on the card, for each moment of a run. `again` is when a daily limit lets it start again, in words
 * ("1:35 PM tomorrow"); `held` says that moment hasn't come yet.
 */
export function organizeWords(run: OrganizeRun | undefined, waitingCount: number, { again, held = false }: { again?: string; held?: boolean } = {}) {
  if (!run) return {
    heading: waitingCount === 1 ? "1 saved post is waiting to be organized" : `${waitingCount} saved posts are waiting to be organized`,
    body: held ? `Today’s processing allowance is used. You can organize ${waitingCount === 1 ? "it" : "them"}${again ? ` after ${again}` : " tomorrow"}.`
      : "Håfa can read each one and add a summary, topics and a suggested category. It goes a few at a time, within your daily allowance.",
  };
  const settled = run.organized + run.attention.length, left = run.waiting.length + run.active.length;
  if (!run.finished_at && run.stopped === "cancelled") return {
    heading: "Stopping after the ones being read",
    body: `${settled} of ${run.total} done. ${run.active.length === 1 ? "1 is" : `${run.active.length} are`} still being read${run.waiting.length
      ? `, and the other ${run.waiting.length === 1 ? "1 stays" : `${run.waiting.length} stay`} saved as ${run.waiting.length === 1 ? "it is" : "they are"}` : ""}.`,
  };
  if (!run.finished_at) return {
    heading: `Organizing ${posts(run.total)}`,
    body: run.paused_until ? "Other posts are being read right now. This continues in a couple of minutes."
      : `${settled} of ${run.total} done. A few go at a time, and it keeps going while the app is open.`,
  };
  const organized = run.organized === run.total ? (run.total === 1 ? "Your saved post is organized." : `All ${run.total} saved posts are organized.`)
    : `Organized ${run.organized} of ${posts(run.total)}.`;
  const attention = run.attention.length
    ? ` ${run.attention.length === 1 ? "1 couldn’t be read" : `${run.attention.length} couldn’t be read`} this time. Their originals are kept, and each one’s page has Try again.` : "";
  const rest = run.stopped === "limit" && left ? ` ${left === 1 ? "1 is" : `${left} are`} still waiting: today’s processing allowance is used. You can organize the rest ${again ? `after ${again}` : "tomorrow"}.`
    : run.stopped === "ai_off" && left ? ` ${left === 1 ? "1 is" : `${left} are`} still waiting: AI processing is off or unavailable right now. You can organize the rest later.`
    : run.stopped === "cancelled" && left ? ` ${left === 1 ? "1 is" : `${left} are`} still saved as ${left === 1 ? "it was" : "they were"}.` : "";
  return { heading: run.attention.length || (run.stopped && left) ? "Done for now" : "All organized",
    body: `${organized}${attention}${rest}${run.organized ? " Suggested categories are in Uncategorized." : ""}`, settled };
}

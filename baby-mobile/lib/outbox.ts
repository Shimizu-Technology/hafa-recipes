import { importFinished } from "./import-status";
import { instant, reduceFeed, withRecordAction } from "./feed-reducer";
import { withSessionAction } from "./session-actions";
import type { BabyRecord, Child, DeviceState, EditorDraft, ImportJob, Mutation, RecordWrite, SaveBase, SettledChange } from "./models";
export function replaceRecord(records: BabyRecord[], record: BabyRecord) {
  return [record, ...records.filter((r) => r.id !== record.id)].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at)
  );
}
export function pendingRecords(state: DeviceState) {
  let rows = state.records;
  for (const change of state.outbox) {
    if (change.type === "save") {
      const prior = rows.find((r) => r.id === change.record.id);
      rows = replaceRecord(rows, {
        ...change.record,
        revision: change.record.revision ?? 0,
        created_at: prior?.created_at ?? change.record.occurred_at,
        updated_at: change.record.occurred_at,
      });
    } else if (change.type === "delete") rows = rows.filter((r) => r.id !== change.record.id);
    else if (change.type === "feed_action")
      rows = rows.map((r) => (r.id === change.record_id ? withRecordAction(r, change.action) : r));
    else if (change.type === "session_action")
      rows = rows.map((r) => (r.id === change.record_id ? withSessionAction(r, change.action) : r));
  }
  return rows;
}
export function addMutation(state: DeviceState, mutation: Mutation) {
  if (state.outbox.some((m) => m.id === mutation.id)) return state;
  const shown = mutation.type === "save" && !mutation.base && pendingRecords(state).some((r) => r.id === mutation.record.id);
  return { ...state, outbox: [...state.outbox, shown ? { ...mutation, base: baseOf(state, mutation.record.id) } : mutation] };
}
/** The queued changes already in the copy she sees. An editor keeps this from the moment it opens. */
export function baseOf(state: DeviceState, id: string): SaveBase {
  return { after: state.outbox.filter((m) => mutationRecordId(m) === id).map((m) => m.id) };
}
/** Bounded, but what a kept draft still needs to know stays. */
export function withSettled(state: DeviceState, id: string, outcome: SettledChange): DeviceState {
  const needed = new Set(Object.values(state.drafts).flatMap((draft) => draft.base?.after ?? [])),
    rows = [...Object.entries(state.settled ?? {}), [id, outcome] as const];
  return { ...state, settled: Object.fromEntries(rows.filter(([key], at) => at >= rows.length - 50 || needed.has(key))) };
}
/** A queued change and all that's queued after it on the same record. Each was built on the one before, so they go together. */
export function queuedChain(outbox: Mutation[], change: Mutation) {
  const at = outbox.findIndex((m) => m.id === change.id), id = mutationRecordId(change);
  return at < 0 ? [] : outbox.slice(at).filter((m, index) => !index || (!!id && mutationRecordId(m) === id));
}
export const laterChangesNotice = (later: number) =>
  later ? `This also removes ${later} later ${later === 1 ? "change" : "changes"} to this entry.` : "";
/**
 * Discards a queued change and its chain, and queues the release of uploads nothing left refers to. It's one write, so
 * it can't half-apply. `server` is the record as read just now, and null if it's gone. A sent tap can turn out to have
 * landed, and then that read proves the revision it made.
 */
export function withoutChain(state: DeviceState, removed: Mutation, server?: BabyRecord | null): DeviceState {
  const gone = new Set(queuedChain(state.outbox, removed).map((m) => m.id)), id = mutationRecordId(removed),
    made = server && removed.type !== "save" ? producedRevision(removed, server) : undefined;
  const noted = [...gone].reduce((next, change) => withSettled(next, change, change === removed.id && made !== undefined ? { made } : { discarded: true }), state);
  return queueRemovedUploads(state, { ...noted, outbox: state.outbox.filter((m) => !gone.has(m.id)),
    ...(server ? { records: replaceRecord(state.records, server) } : server === null ? { records: state.records.filter((r) => r.id !== id) } : {}) });
}
/**
 * An open or kept draft, once changes it was built on have left the outbox. What she wrote stays as it is, and only its
 * revision moves. It goes up one step for a change it saw land, which is what proves the new revision holds nothing it
 * hasn't seen. A discarded change never reached the saved row, so it goes back to that row's revision, but never up to
 * one it hasn't seen: the API answers that with a conflict for review.
 */
export function settledDraft(draft: EditorDraft, state: DeviceState): EditorDraft {
  const built = draft.base?.after;
  if (!built?.length) return draft;
  const after = built.filter((id) => state.outbox.some((m) => m.id === id));
  if (after.length === built.length) return draft;
  const saved = state.records.find((r) => r.id === draft.id)?.revision;
  let revision = draft.revision ?? 0;
  for (const id of built) {
    if (after.includes(id)) continue;
    const outcome = state.settled?.[id];
    if (outcome?.made !== undefined && revision + 1 === outcome.made) revision = outcome.made;
    else if (outcome?.discarded && saved !== undefined) revision = Math.min(revision, saved);
  }
  return { ...draft, revision: revision || draft.revision, base: { after } };
}
export function fencedState(state: DeviceState, generation: number) {
  if (
    (state.bootstrap && state.bootstrap.generation !== generation) ||
    (state.routine_sync && state.routine_sync.generation !== generation)
  ) {
    const { routine_sync: _, feedTimer: __, feedNotices: ___, settled: ____, ...rest } = state;
    return {
      ...rest,
      records: [],
      fileUploads: {},
      fileReleases: [],
      drafts: {},
      outbox: [],
      imports: [],
      selectedChild: null,
    };
  }
  return state;
}
export function shouldRetry(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}
/** Release only uploads removed from local work. The server independently keeps
 * files referenced by saved records or live imports, including other devices. */
export function uploadedReferences(state: DeviceState) {
  return new Set(
    [
      ...Object.values(state.drafts).flatMap((draft) => draft.files),
      ...state.outbox.flatMap((mutation) => ("files" in mutation ? mutation.files : [])),
    ]
      .map((file) => file.uploaded_id ?? state.fileUploads?.[file.id])
      .filter((id): id is string => !!id)
  );
}
export function queueRemovedUploads(before: DeviceState, after: DeviceState): DeviceState {
  const remaining = uploadedReferences(after);
  return {
    ...after,
    fileReleases: [
      ...new Set([
        ...(after.fileReleases ?? []),
        ...[...uploadedReferences(before)].filter((id) => !remaining.has(id)),
      ]),
    ],
  };
}
export function searchLocal(record: BabyRecord, query: string) {
  const corpus = [
    record.title,
    record.body,
    record.data.source_text,
    record.data.summary,
    ...(record.data.topics ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => corpus.includes(word));
}

export function inheritedFiles(state: DeviceState, id: string) {
  const files = state.outbox.flatMap((m) => (m.type === "save" && m.record.id === id ? m.files : []));
  return [
    ...new Map(files.map((f) => [f.id, { ...f, uploaded_id: f.uploaded_id ?? state.fileUploads?.[f.id] }])).values(),
  ];
}
/** Side and duration still as the feed's own actions say, so a parent hasn't corrected them by hand. */
function derivedOnly({ data }: RecordWrite) {
  const reduced = reduceFeed(data.actions);
  return !!reduced && data.side === (reduced.side ?? reduced.start_side) && (data.duration_minutes ?? undefined) === reduced.duration_minutes;
}
/**
 * What an edit to a feed sends. Anything that only follows from its taps isn't hers to change, even if one of those taps
 * was since discarded. Left out, the API keeps its own. A side it didn't expect would finish the feed as corrected by hand.
 */
export function feedEdit<T extends RecordWrite>(record: T): T {
  if (!record.revision || record.kind !== "feeding" || !derivedOnly(record)) return record;
  const { actions: _, state: __, side: ___, duration_minutes: ____, end_at: _____, ...data } = record.data;
  return { ...record, data };
}
/** A queued edit takes what the API worked out from the taps. Otherwise an unchanged duration would look like a correction. */
function withServerFeed(record: RecordWrite, result: BabyRecord): RecordWrite {
  const { actions, state, side, duration_minutes, end_at, ...rest } = record.data,
    { actions: a, state: st, side: si, duration_minutes: du, end_at: en } = result.data;
  return { ...record, data: { ...rest, actions: a, state: st, side: si, duration_minutes: du, ...(en ? { end_at: en } : {}) } };
}
/**
 * The revision a finished request is proven to have made. A save's follows from the one it sent: a create is always 1,
 * and a PATCH only lands on its own revision. A tap needs no revision and can be a replay, so only the API can say,
 * on the action it stored. The row's own revision proves nothing: another phone may have written since.
 */
export function producedRevision(done: Mutation, row: BabyRecord) {
  if (done.type === "save") return done.record.revision ? done.record.revision + 1 : 1;
  if (done.type === "feed_action") return row.data.actions?.find((known) => known.id === done.action.id)?.revision;
  if (done.type === "session_action") return row.data.session_actions?.find((known) => known.id === done.action.id)?.revision;
  return undefined;
}
/**
 * A change built just before this request follows it, and only that one step. Anything else keeps its revision, and the
 * API answers it with a conflict for review. That fence is what stops it overwriting an edit it never saw, or deleting
 * a record it never saw.
 */
export function advancePending(m: Mutation, done: Mutation, result: BabyRecord): Mutation {
  if ((m.type !== "save" && m.type !== "delete") || m.record.id !== result.id) return m;
  // A save that never saw this request has nothing of it in, so this revision isn't its to follow.
  if (m.type === "save" && m.base && !m.base.after.includes(done.id)) return m;
  const made = producedRevision(done, result);
  if (made === undefined || (m.record.revision ?? 0) + 1 !== made) return m;
  if (m.type === "delete") return { ...m, record: { ...m.record, revision: made } };
  // Later writes aren't this one's to take: the API refuses the edit anyway, and she compares them in review.
  const record = done.type === "feed_action" && result.revision === made && m.record.kind === "feeding" && derivedOnly(m.record) ? withServerFeed(m.record, result) : m.record;
  return { ...m, record: { ...record, revision: made }, ...(m.base ? { base: { ...m.base, after: m.base.after.filter((id) => id !== done.id) } } : {}) };
}
/** What a 404 or 409 on a tap means, once the record has been read again. Only a record known to be gone or untimed loses it. */
export function rejectedAction(row: BabyRecord | null, action: { id: string }): "removed" | "plain" | "applied" | "unresolved" {
  if (!row) return "removed";
  if ([...(row.data.actions ?? []), ...(row.data.session_actions ?? [])].some((known) => known.id === action.id)) return "applied";
  return row.data.actions?.length || row.data.session_actions?.length || row.data.state === "running" || row.data.state === "unknown_end" ? "unresolved" : "plain";
}
/** Added once each, oldest first, so one can't hide another. */
export function withNotice(state: DeviceState, notice: string): DeviceState {
  return state.feedNotices?.includes(notice) ? state : { ...state, feedNotices: [...(state.feedNotices ?? []), notice] };
}
export const removedFeedNotice = "This feed was removed.";
export const removedSessionNotice = "This entry was removed, so the tap wasn’t added.";
export const plainFeedNotice = "This feed was changed, and the saved one stands.";
export const finishedFeedNotice = "This feed had already finished.";
/** A switch that landed after the feed's finish does nothing, so she hears about it rather than seeing nothing change. */
export function switchTooLate(action: { action: string; at: string }, result: BabyRecord) {
  return action.action === "switch" && !!result.data.end_at && instant(result.data.end_at) <= instant(action.at);
}
/** Tries a tap again with the same id, further apart each time, so a bad minute on the server doesn't lose or suspend it. */
export function retryLater<T extends Extract<Mutation, { type: "feed_action" | "session_action" | "child_birth" | "save" }>>(change: T, now = Date.now()): T {
  const attempts = (change.attempts ?? 0) + 1;
  return { ...change, attempts, hold_until: new Date(now + Math.min(5000 * 2 ** (attempts - 1), 5 * 60_000)).toISOString() };
}
/** Kinds the API can refuse for now with a 503 until its flag is on, so a build shipped first keeps them queued. */
export function retriedSave(change: Mutation): change is Extract<Mutation, { type: "save" }> {
  return change.type === "save" && (change.record.kind === "contraction" || change.record.kind === "kick_session");
}
/** How many rejected reads of a timed feed to try before asking her. */
export const unresolvedAttempts = 5;

/** All operations on a record share one durable order, including source imports.
 * An unresolved ancestor holds only its own record, never the entire outbox. */
export function mutationRecordId(change: Mutation) {
  if (change.type === "child_birth") return change.child_id;
  return change.type === "save" || change.type === "delete" ? change.record.id : change.record_id;
}
/** Still inside its Undo window; the sync loop comes back for it. */
export function heldUntil(change: Mutation, now = Date.now()) {
  if (change.type === "delete" || change.type === "import" || !change.hold_until) return 0;
  const until = new Date(change.hold_until).getTime();
  return until > now ? until : 0;
}
export function waitingForEarlier(outbox: Mutation[], change: Mutation) {
  const recordId = mutationRecordId(change);
  return !!recordId && outbox.slice(0, outbox.findIndex((m) => m.id === change.id))
    .some((m) => mutationRecordId(m) === recordId);
}
export function retryMutation<T extends Mutation>(change: T): T {
  return { ...change, error: undefined, conflict: false, localOnly: false };
}

/** A pending birth date shows everywhere as soon as it's tapped, and stays through every refresh until it lands. */
export function withPendingBirths(state: DeviceState): DeviceState {
  if (!state.bootstrap || !state.outbox.some((m) => m.type === "child_birth")) return state;
  const children = state.outbox.reduce<Child[]>((rows, m) => m.type !== "child_birth" ? rows
    : rows.map((child) => (child.id === m.child_id && (child.birth_date ?? null) !== m.birth_date ? { ...child, birth_date: m.birth_date } : child)), state.bootstrap.children);
  return children === state.bootstrap.children ? state : { ...state, bootstrap: { ...state.bootstrap, children } };
}
/** What a removed birth change leaves behind: what the API said, or else what it saw before. */
export function withoutBirth(state: DeviceState, m: Extract<Mutation, { type: "child_birth" }>, server?: Child): DeviceState {
  if (!state.bootstrap) return state;
  return { ...state, bootstrap: { ...state.bootstrap,
    children: state.bootstrap.children.map((child) => (child.id !== m.child_id ? child : server ?? { ...child, birth_date: m.previous })) } };
}
/**
 * What to do with a birth change, from the API's copy. Its revision is only how a write gets in: the question is the
 * date. Already there is a replay or the other phone. Still what it saw means send it, at whatever revision the row is
 * on now, so a conflict on another field can't lose it. A different date is someone's decision, and she reviews it.
 */
export function birthStep(server: Child | undefined, m: Extract<Mutation, { type: "child_birth" }>): "gone" | "done" | "send" | "different" {
  if (!server) return "gone";
  const saved = server.birth_date ?? null;
  return saved === m.birth_date ? "done" : saved === m.previous ? "send" : "different";
}

/** Admission is not completion: an import may still replace source fields. */
export function waitingForImport(imports: ImportJob[], change: Mutation) {
  return change.type === "save" && imports.some(job => job.record_id === change.record.id && job.status !== "deferred" &&
    (!importFinished(job.status) || !job.reconciled));
}

const processingFields = new Set([
  "url", "source_text", "topics", "attachment_ids", "summary", "key_points", "steps", "evidence",
  "creator", "platform", "thumbnail_url", "coverage_notes", "status",
]);
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a), other = Object.keys(b);
  return keys.length === other.length && keys.every(key => Object.hasOwn(b, key) &&
    same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/** Admission increments once; the worker increments once only when its baseline
 * still matches. A later remote
 * write increments again; a write during processing makes the job incomplete with
 * an error. Never turn either case (or an old job without a baseline) into a save. */
export function advanceAfterImport(change: Mutation, result: BabyRecord, job?: ImportJob): Mutation {
  if (change.type !== "save" || change.record.id !== result.id) return change;
  const before = job?.baseline, local = change.record;
  const onlyOwned = before && ["id", "kind", "body", "child_id", "occurred_at"].every(key =>
    same(before[key as keyof BabyRecord], result[key as keyof BabyRecord])) &&
    (before.title === result.title || before.title === "Saved source" || job.automatic) &&
    [...new Set([...Object.keys(before.data), ...Object.keys(result.data)])].every(key =>
      processingFields.has(key) || same(before.data[key], result.data[key]));
  const completedWrite = before && result.revision === before.revision + 2 && !job?.error &&
    (job?.status === "ready" || job?.status === "incomplete");
  const noWrite = before && result.revision === before.revision + 1 && job?.status !== "ready" && !job?.error &&
    same({ ...before.data, status: undefined }, { ...result.data, status: undefined }) && before.title === result.title;
  if (!before || before.cache_partial || local.revision !== before.revision || !onlyOwned || !(completedWrite || noWrite))
    return { ...change, conflict: true, error: "This source changed while it processed. Your local version is safe. Compare the saved version before retrying." };
  const data = { ...local.data };
  for (const key of new Set([...Object.keys(before.data), ...Object.keys(result.data)])) {
    if (key === "attachment_ids") {
      const original = before.data.attachment_ids ?? [], selected = local.data.attachment_ids ?? [];
      const removed = new Set(original.filter(id => !selected.includes(id)));
      data.attachment_ids = [...new Set([...(result.data.attachment_ids ?? []).filter(id => !removed.has(id)),
        ...selected.filter(id => !original.includes(id))])];
      continue;
    }
    // Keep deliberate edits, but acquire new originals/metadata when that field
    // was untouched locally. Processing-only fields always belong to the result.
    const editable = ["url", "source_text", "topics", "attachment_ids"].includes(key);
    if (!editable || same(local.data[key], before.data[key])) {
      if (key in result.data) data[key] = result.data[key];
      else delete data[key];
    }
  }
  return { ...change, record: { ...local, revision: result.revision, data,
    title: local.title === before.title ? result.title : local.title } };
}

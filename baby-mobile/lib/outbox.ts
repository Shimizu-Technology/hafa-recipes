import { importFinished } from "./import-status";
import { instant, reduceFeed, withRecordAction } from "./feed-reducer";
import { withSessionAction } from "./session-actions";
import { careKinds } from "./models";
import { trackedKinds } from "./trackers";
import { familySpaces, generationOf, goneBabyMessage, spaceForNew, spacesLive, stuckTapMessage, unavailableMessage } from "./spaces";
import type { BabyRecord, Bootstrap, Child, DeviceState, EditorDraft, ImportJob, Kind, Mutation, RecordWrite, SaveBase, SettledChange } from "./models";
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
        ...(change.space_id ? { space_id: change.space_id } : {}),
      });
    } else if (change.type === "event_split") {
      for (const record of [change.series, change.event]) {
        const prior = rows.find((r) => r.id === record.id);
        rows = replaceRecord(rows, { ...record, revision: record.revision ?? 0, created_at: prior?.created_at ?? record.occurred_at, updated_at: record.occurred_at, ...(change.space_id ? { space_id: change.space_id } : {}) });
      }
    } else if (change.type === "delete") rows = rows.filter((r) => r.id !== change.record.id);
    else if (change.type === "feed_action")
      rows = rows.map((r) => (r.id === change.record_id ? withRecordAction(r, change.action) : r));
    else if (change.type === "session_action")
      rows = rows.map((r) => (r.id === change.record_id ? withSessionAction(r, change.action) : r));
  }
  return rows;
}
/** Where a queued change is going. Whatever touches a row goes where that row lives, and only a new one gets to choose. */
function targetOf(state: DeviceState, m: Mutation) {
  const home = (id?: string | null) => (id ? state.records.find((r) => r.id === id)?.space_id ?? state.outbox.find((q) => q.space_id && mutationRecordIds(q).includes(id))?.space_id : undefined),
    personal = state.bootstrap?.personal_space_id;
  if (m.type === "save") return home(m.record.id) ?? spaceForNew(state, m.record);
  if (m.type === "event_split") return home(m.series.id) ?? spaceForNew(state, m.series);
  if (m.type === "delete") return m.record.space_id ?? home(m.record.id) ?? personal;
  if (m.type === "child_birth" || m.type === "child_tracking") return state.bootstrap?.children.find((child) => child.id === m.child_id)?.space_id ?? personal;
  if (m.type === "import") return home(m.record_id) ?? spaceForNew(state, { kind: "source", child_id: m.child_id ?? null, data: {} });
  return home(m.record_id) ?? personal;
}
export function addMutation(state: DeviceState, mutation: Mutation) {
  if (state.outbox.some((m) => m.id === mutation.id)) return state;
  const space = spacesLive(state.bootstrap) ? mutation.space_id ?? targetOf(state, mutation) : undefined,
    stamped = space ? { ...mutation, space_id: space, generation: generationOf(state.bootstrap, space) ?? mutation.generation } : mutation,
    shown = stamped.type === "save" && !stamped.base && pendingRecords(state).some((r) => r.id === stamped.record.id);
  return { ...state, outbox: [...state.outbox, shown && stamped.type === "save" ? { ...stamped, base: baseOf(state, stamped.record.id) } : stamped] };
}
/** The queued changes already in the copy she sees. An editor keeps this from the moment it opens. */
export function baseOf(state: DeviceState, id: string): SaveBase {
  return { after: state.outbox.filter((m) => mutationRecordIds(m).includes(id)).map((m) => m.id) };
}
/** Bounded, but what a kept draft still needs to know stays. */
export function withSettled(state: DeviceState, id: string, outcome: SettledChange): DeviceState {
  const needed = new Set(Object.values(state.drafts).flatMap((draft) => draft.base?.after ?? [])),
    rows = [...Object.entries(state.settled ?? {}), [id, outcome] as const];
  return { ...state, settled: Object.fromEntries(rows.filter(([key], at) => at >= rows.length - 50 || needed.has(key))) };
}
/** A queued change and all that's queued after it on the same record. Each was built on the one before, so they go together. */
export function queuedChain(outbox: Mutation[], change: Mutation) {
  const at = outbox.findIndex((m) => m.id === change.id), ids = new Set(mutationRecordIds(change));
  return at < 0 ? [] : outbox.slice(at).filter((m, index) => {
    const mine = mutationRecordIds(m);
    if (index && !mine.some((id) => ids.has(id))) return false;
    // A split takes both events along, so what follows on either goes with it.
    mine.forEach((id) => ids.add(id));
    return true;
  });
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
    const made = outcome?.made_for?.[draft.id] ?? outcome?.made;
    if (made !== undefined && revision + 1 === made) revision = made;
    else if (outcome?.discarded && saved !== undefined) revision = Math.min(revision, saved);
  }
  return { ...draft, revision: revision || draft.revision, base: { after } };
}
/**
 * Pending work belongs to its space. A cleared personal space takes its own work and leaves a family's, and a family's
 * generation changing takes only that family's. Joining a space, moving a row, or the flag turning on changes neither.
 */
export function fencedState(state: DeviceState, next: number | Pick<Bootstrap, "generation" | "spaces">) {
  const generation = typeof next === "number" ? next : next.generation, spaces = typeof next === "number" ? undefined : next.spaces,
    families = familySpaces(state.bootstrap),
    retired = new Set(families.filter((space) => spaces?.some((now) => now.id === space.id && now.generation !== space.generation)).map((space) => space.id)),
    surviving = new Set(families.filter((space) => !retired.has(space.id) && spaces?.some((now) => now.id === space.id)).map((space) => space.id));
  if (
    (state.bootstrap && state.bootstrap.generation !== generation) ||
    (state.routine_sync && state.routine_sync.generation !== generation)
  ) {
    const { routine_sync: _, feedTimer: __, feedNotices: ___, settled: ____, childDrafts: _____, changes, ...rest } = state,
      kept = (id?: string) => !!id && surviving.has(id);
    return {
      ...rest,
      records: state.records.filter((row) => kept(row.space_id)),
      fileUploads: {},
      fileReleases: [],
      drafts: {},
      outbox: state.outbox.filter((m) => kept(m.space_id)),
      imports: [],
      selectedChild: null,
      ...(changes && surviving.size ? { changes: { cursor: Object.fromEntries(Object.entries(changes.cursor).filter(([id]) => kept(id))), access: Object.fromEntries(Object.entries(changes.access).filter(([id]) => kept(id))) } } : {}),
    };
  }
  if (retired.size) {
    const gone = (id?: string) => !!id && retired.has(id);
    return {
      ...state,
      records: state.records.filter((row) => !gone(row.space_id)),
      outbox: state.outbox.filter((m) => !gone(m.space_id)),
      ...(state.changes ? { changes: { cursor: Object.fromEntries(Object.entries(state.changes.cursor).filter(([id]) => !gone(id))), access: Object.fromEntries(Object.entries(state.changes.access).filter(([id]) => !gone(id))) } } : {}),
    };
  }
  return state;
}
/** An older build saved no spaces, and all of it was personal. The first bootstrap that lists them says so, and nothing else moves. */
export function withKnownSpaces(state: DeviceState, bootstrap: Bootstrap): DeviceState {
  const personal = bootstrap.personal_space_id;
  if (!spacesLive(bootstrap) || !personal || (state.records.every((row) => row.space_id) && state.outbox.every((m) => m.space_id))) return state;
  return { ...state,
    records: state.records.map((row) => (row.space_id ? row : { ...row, space_id: personal, generation: bootstrap.generation })),
    outbox: state.outbox.map((m) => (m.space_id ? m : { ...m, space_id: personal, generation: bootstrap.generation })) };
}
/** Sends again what was refused only because its row or baby couldn't be seen, as now it might: the API can say where it moved. */
export function retryUnavailable(state: DeviceState): DeviceState {
  const gone = new Set([unavailableMessage, goneBabyMessage, stuckTapMessage]);
  return state.outbox.some((m) => m.error && gone.has(m.error)) ? { ...state, outbox: state.outbox.map((m) => (m.error && gone.has(m.error) && !m.localOnly ? retryMutation(m) : m)) } : state;
}
export const deviceVersion = 2;
/** One step for what an older build saved: everything's kept, including drafts, the queue and a running timer. */
export function upgradedState(saved: DeviceState): DeviceState {
  return (saved.version ?? 1) >= deviceVersion ? saved : { ...retryUnavailable(saved), version: deviceVersion };
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
  if (done.type === "event_split") return row.id === done.event.id ? 1 : (done.series.revision ?? 0) + 1;
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
  if (m.type === "event_split") {
    if (m.series.id !== result.id || (m.base && !m.base.after.includes(done.id))) return m;
    const made = producedRevision(done, result);
    if (made === undefined || (m.series.revision ?? 0) + 1 !== made) return m;
    return { ...m, series: { ...m.series, revision: made }, ...(m.base ? { base: { ...m.base, after: m.base.after.filter((id) => id !== done.id) } } : {}) };
  }
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
/** What a landed split made of each event, for an editor that was open on either. */
export const settledSplit = (done: Extract<Mutation, { type: "event_split" }>): SettledChange => ({
  made_for: { [done.series.id]: (done.series.revision ?? 0) + 1, [done.event.id]: 1 },
});
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
export function retryLater<T extends Extract<Mutation, { type: "feed_action" | "session_action" | "child_birth" | "child_tracking" | "save" | "event_split" | "delete" }>>(change: T, now = Date.now()): T {
  const attempts = (change.attempts ?? 0) + 1;
  return { ...change, attempts, hold_until: new Date(now + Math.min(5000 * 2 ** (attempts - 1), 5 * 60_000)).toISOString() };
}
/** Kinds the API can refuse for now with a 503 until its flag is on, so a build shipped first keeps them queued. */
const retriedKinds: readonly Kind[] = trackedKinds.filter((kind) => !careKinds.includes(kind));
export function retriedSave(change: Mutation): change is Extract<Mutation, { type: "save" }> {
  return change.type === "save" && retriedKinds.includes(change.record.kind);
}
/** How many rejected reads of a timed feed to try before asking her. */
export const unresolvedAttempts = 5;

/** All operations on a record share one durable order, including source imports.
 * An unresolved ancestor holds only its own record, never the entire outbox. */
export function mutationRecordId(change: Mutation) {
  if (change.type === "child_birth" || change.type === "child_tracking") return change.child_id;
  if (change.type === "event_split") return change.series.id;
  return change.type === "save" || change.type === "delete" ? change.record.id : change.record_id;
}
/** Every record a change touches. Only a split has two, and each waits on what's before it. */
export function mutationRecordIds(change: Mutation) {
  if (change.type === "event_split") return [change.series.id, change.event.id];
  const id = mutationRecordId(change);
  return id ? [id] : [];
}
/** Still inside its Undo window; the sync loop comes back for it. */
export function heldUntil(change: Mutation, now = Date.now()) {
  if (change.type === "import" || !change.hold_until) return 0;
  const until = new Date(change.hold_until).getTime();
  return until > now ? until : 0;
}
export function waitingForEarlier(outbox: Mutation[], change: Mutation) {
  const ids = mutationRecordIds(change);
  return outbox.slice(0, outbox.findIndex((m) => m.id === change.id))
    .some((m) => mutationRecordIds(m).some((id) => ids.includes(id)));
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

/** A switch shows everywhere as soon as it's tapped, and stays through every refresh until it lands. */
export function withPendingTracking(state: DeviceState): DeviceState {
  if (!state.bootstrap || !state.outbox.some((m) => m.type === "child_tracking")) return state;
  let changed = false;
  const children = state.bootstrap.children.map((child) => {
    const chosen = Object.assign({}, ...state.outbox.map((m) => (m.type === "child_tracking" && m.child_id === child.id ? m.tracking : {}))) as Record<string, boolean>;
    if (Object.entries(chosen).every(([key, on]) => child.details?.tracking?.[key] === on)) return child;
    changed = true;
    return { ...child, details: { ...child.details, tracking: { ...child.details?.tracking, ...chosen } } };
  });
  return changed ? { ...state, bootstrap: { ...state.bootstrap, children } } : state;
}
/** What a removed switch leaves behind: what the API said, or else what it saw before. */
export function withoutTracking(state: DeviceState, m: Extract<Mutation, { type: "child_tracking" }>, server?: Child): DeviceState {
  if (!state.bootstrap) return state;
  return { ...state, bootstrap: { ...state.bootstrap, children: state.bootstrap.children.map((child) => {
    if (child.id !== m.child_id) return child;
    if (server) return server;
    const tracking = { ...child.details?.tracking };
    for (const [key, was] of Object.entries(m.previous)) { if (was === null) delete tracking[key]; else tracking[key] = was; }
    return { ...child, details: { ...child.details, tracking } };
  }) } };
}
/** What to do with a switch, from the API's copy. It merges key by key, so whichever phone's tap came last stands. */
export function trackingStep(server: Child | undefined, m: Extract<Mutation, { type: "child_tracking" }>): "gone" | "done" | "send" {
  if (!server) return "gone";
  return Object.entries(m.tracking).every(([key, on]) => server.details?.tracking?.[key] === on) ? "done" : "send";
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

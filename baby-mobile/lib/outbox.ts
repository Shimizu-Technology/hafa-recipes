import { importFinished } from "./import-status";
import type { BabyRecord, DeviceState, ImportJob, Mutation } from "./models";
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
  }
  return rows;
}
export function addMutation(state: DeviceState, mutation: Mutation) {
  if (state.outbox.some((m) => m.id === mutation.id)) return state;
  return { ...state, outbox: [...state.outbox, mutation] };
}
export function fencedState(state: DeviceState, generation: number) {
  if (
    (state.bootstrap && state.bootstrap.generation !== generation) ||
    (state.routine_sync && state.routine_sync.generation !== generation)
  ) {
    const { routine_sync: _, feedTimer: __, ...rest } = state;
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
      ...state.outbox.flatMap((mutation) => (mutation.type === "delete" ? [] : mutation.files)),
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
export function advancePending(m: Mutation, result: BabyRecord): Mutation {
  if (m.type === "import" || m.record.id !== result.id) return m;
  if (m.type === "delete") return { ...m, record: { ...m.record, revision: result.revision } };
  return { ...m, record: { ...m.record, revision: result.revision } };
}

/** All operations on a record share one durable order, including source imports.
 * An unresolved ancestor holds only its own record, never the entire outbox. */
export function mutationRecordId(change: Mutation) {
  return change.type === "import" ? change.record_id : change.record.id;
}
export function waitingForEarlier(outbox: Mutation[], change: Mutation) {
  const recordId = mutationRecordId(change);
  return !!recordId && outbox.slice(0, outbox.findIndex((m) => m.id === change.id))
    .some((m) => mutationRecordId(m) === recordId);
}
export function retryMutation<T extends Mutation>(change: T): T {
  return { ...change, error: undefined, conflict: false, localOnly: false };
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

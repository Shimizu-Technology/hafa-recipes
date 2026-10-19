import type { BabyRecord, DeviceState, Mutation } from "./models";
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
    const { routine_sync: _, ...rest } = state;
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

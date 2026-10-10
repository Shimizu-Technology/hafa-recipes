import type { TrainingProfile, Enrollment } from "./models";
export interface ExportPage {
  schema_version: 1;
  generated_at: string;
  enrollment: Enrollment;
  profile: TrainingProfile | null;
  profile_revision: number;
  ai_consent: unknown;
  grants: unknown[];
  datasets: Record<string, Record<string, unknown>[]>;
  totals: Record<string, number>;
  has_more: Record<string, boolean>;
  offset: number;
  limit: number;
}
function utf8Size(text: string) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
function recordKey(dataset: string, row: Record<string, unknown>) {
  if (typeof row.id === "string") return row.id;
  if (dataset === "health_connections") return String(row.provider);
  if (dataset === "health_owned_writes") return `${row.provider}:${row.canonical_session_id}:${row.revision}`;
  if (dataset === "library_organization") return String(row.workout_id);
  if (dataset === "library_collection_members") return `${row.collection_id}:${row.workout_id}`;
  if (typeof row.source_id === "string") return `${row.provider}:${row.source_id}`;
  return JSON.stringify(row);
}
export async function collectExport(
  fetchPage: (offset: number) => Promise<ExportPage>,
  generation: number,
  guard: () => void,
  maxPages = 200
) {
  let first: ExportPage | null = null;
  let bytes = 0;
  const datasets: ExportPage["datasets"] = {};
  const ids: Record<string, Set<string>> = {};
  for (let page = 0; page < maxPages; page++) {
    guard();
    const data = await fetchPage(page * 10);
    guard();
    if (data.offset !== page * 10 || data.limit !== 10)
      throw Error("Export paging changed unexpectedly. Start a fresh export.");
    if (data.enrollment.generation !== generation)
      throw Error("Your Workouts data changed while exporting. Start a fresh export.");
    if (
      first &&
      (data.profile_revision !== first.profile_revision ||
        JSON.stringify(data.totals) !== JSON.stringify(first.totals) ||
        JSON.stringify(data.grants) !== JSON.stringify(first.grants) ||
        JSON.stringify(data.ai_consent) !== JSON.stringify(first.ai_consent))
    )
      throw Error("Saved data or permissions changed while exporting. Start again to avoid a mixed file.");
    if (!first) first = data;
    bytes += utf8Size(JSON.stringify(data));
    if (bytes > 64 * 1024 * 1024)
      throw Error("This private export is too large for one device operation. Contact support for a complete export.");
    for (const [name, rows] of Object.entries(data.datasets)) {
      datasets[name] ??= [];
      ids[name] ??= new Set();
      for (const row of rows) {
        const key = recordKey(name, row);
        if (ids[name].has(key)) throw Error("A saved record moved while exporting. Start a fresh export.");
        ids[name].add(key);
        datasets[name].push(row);
      }
    }
    if (!Object.values(data.has_more).some(Boolean)) {
      for (const [name, total] of Object.entries(data.totals))
        if ((datasets[name]?.length ?? 0) !== total)
          throw Error("A dataset could not be exported completely. Your data remains saved.");
      return {
        ...first,
        datasets,
        has_more: Object.fromEntries(Object.keys(datasets).map((name) => [name, false])),
        export_finished_at: data.generated_at,
        notice:
          "This file contains the server records returned during export. Device-only drafts are separate. Concurrent edits with unchanged totals may not be detected; this is not an immutable point-in-time snapshot.",
      };
    }
  }
  throw Error("This export is too large for one device operation. Contact support for a complete export.");
}

export interface ExportManifest {
  id: string;
  generation: number;
  schema_version: 1;
  created_at: string;
  expires_at: string;
  page_count: number;
  page_size: 10;
  totals: Record<string, number>;
}
export interface SnapshotPage {
  snapshot_id: string;
  page: number;
  page_count: number;
  export: ExportPage;
}
export async function collectSnapshotExport(
  manifest: ExportManifest,
  fetchPage: (page: number) => Promise<SnapshotPage>,
  guard: () => void,
  onPage?: (completed: number) => void
) {
  if (
    !Number.isInteger(manifest.page_count) ||
    manifest.page_count < 1 ||
    manifest.page_count > 512 ||
    manifest.page_size !== 10
  )
    throw Error("The saved export manifest is invalid. Start a fresh export.");
  const result = await collectExport(
    async (offset) => {
      guard();
      const page = offset / 10;
      const data = await fetchPage(page);
      guard();
      if (
        data.snapshot_id !== manifest.id ||
        data.page !== page ||
        data.page_count !== manifest.page_count ||
        JSON.stringify(data.export.totals) !== JSON.stringify(manifest.totals)
      )
        throw Error("The private snapshot changed. Discard this partial export and start again.");
      if (Object.values(data.export.has_more).some(Boolean) !== page < manifest.page_count - 1)
        throw Error("The private snapshot page sequence is incomplete.");
      onPage?.(page + 1);
      guard();
      return data.export;
    },
    manifest.generation,
    guard,
    manifest.page_count
  );
  return {
    ...result,
    snapshot: { id: manifest.id, created_at: manifest.created_at },
    notice:
      "This file contains one fixed snapshot of your server-saved Workouts records. Device-only drafts and original OS Health records are separate.",
  };
}

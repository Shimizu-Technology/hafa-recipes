import { draftKey, type Storage } from "./drafts";

export interface ExportScope {
  owner: string;
  generation: number;
  backend: string;
  binding: string;
}
export interface ExportCommand extends ExportScope {
  schema_version: 1;
  request_id: string;
  job_id: string | null;
  cancel_requested: boolean;
  retired: boolean;
}
const queues = new Map<string, Promise<unknown>>();
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function createExportJobStore(storage: Storage, scope: ExportScope, guard: () => void) {
  const key = draftKey(scope.owner, `export-job:${scope.generation}:${scope.backend}:${scope.binding}`);
  const ordered = <T>(work: () => Promise<T>) => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    queues.set(key, next);
    void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => undefined);
    return next;
  };
  async function read(): Promise<ExportCommand | null> {
    guard();
    const raw = await storage.getItem(key);
    guard();
    if (raw === null) return null;
    let value: ExportCommand | null = null;
    try { value = JSON.parse(raw) as ExportCommand; } catch { /* Preserve the original invalid handle. */ }
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schema_version !== 1 || value.owner !== scope.owner || value.generation !== scope.generation ||
      value.backend !== scope.backend || value.binding !== scope.binding || !safeId(value.request_id) ||
      !(value.job_id === null || safeId(value.job_id)) ||
      typeof value.cancel_requested !== "boolean" || typeof value.retired !== "boolean")
      throw Error("This export recovery handle is invalid. Contact support before creating another export.");
    // Project only content-free fields, even if an older implementation stored extra data.
    return { ...scope, schema_version: 1, request_id: value.request_id, job_id: value.job_id,
      cancel_requested: value.cancel_requested, retired: value.retired };
  }
  async function write(command: ExportCommand) {
    guard();
    await storage.setItem(key, JSON.stringify(command));
    guard();
    return command;
  }
  async function update(requestId: string, apply: (command: ExportCommand) => ExportCommand) {
    const current = await read();
    if (!current || current.retired || current.request_id !== requestId)
      throw Error("This export command changed. Reload before continuing.");
    return write(apply(current));
  }
  return {
    load: () => ordered(read),
    begin: (requestId: string) => ordered(async () => {
      const current = await read();
      if (current && !current.retired) return current;
      if (!safeId(requestId)) throw Error("The export request identifier is invalid.");
      return write({ ...scope, schema_version: 1, request_id: requestId, job_id: null,
        cancel_requested: false, retired: false });
    }),
    attach: (requestId: string, jobId: string) => ordered(() => update(requestId, (current) => {
      if (!safeId(jobId)) throw Error("The export job identifier is invalid.");
      if (current.job_id && current.job_id !== jobId) throw Error("The original export handle changed.");
      return { ...current, job_id: jobId };
    })),
    requestCancel: (requestId: string) => ordered(() => update(requestId, (current) => ({ ...current, cancel_requested: true }))),
    retire: (requestId: string) => ordered(() => update(requestId, (current) => ({ ...current, retired: true }))),
  };
}

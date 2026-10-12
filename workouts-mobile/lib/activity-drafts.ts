import { draftKey, type Storage } from "./drafts";
import type { ActivityDraft, ActivityOperation } from "./activity-log";
const queues = new Map<string, Promise<unknown>>();
interface Box {
  input: ActivityDraft | null;
  operation: ActivityOperation | null;
  finished: boolean;
}
export function createActivityDraftStore(storage: Storage, owner: string, generation: number, focus: string) {
  const key = draftKey(owner, `activity-command:${generation}:${focus}`);
  const ordered = <T>(work: () => Promise<T>) => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    queues.set(key, next);
    void next
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  };
  async function read(): Promise<Box> {
    const raw = await storage.getItem(key);
    return raw ? JSON.parse(raw) : { input: null, operation: null, finished: false };
  }
  async function write(box: Box) {
    await storage.setItem(key, JSON.stringify(box));
  }
  return {
    load: () => ordered(read),
    saveInput: (input: ActivityDraft) =>
      ordered(async () => {
        const current = await read();
        if (current.finished || current.operation) return;
        if (input.owner !== owner || input.generation !== generation)
          throw Error("The activity draft belongs to another account or enrollment.");
        await write({ ...current, input: { ...input, operation: current.operation ?? undefined } });
      }),
    begin: (input: ActivityDraft, operation: ActivityOperation) =>
      ordered(async () => {
        const current = await read();
        if (current.finished) throw Error("This draft was already completed. Start a new activity deliberately.");
        if (operation.owner !== owner || operation.generation !== generation || operation.target_id !== input.target_id)
          throw Error("Activity command ownership changed.");
        if (current.operation && JSON.stringify(current.operation) !== JSON.stringify(operation))
          throw Error("Resolve the existing activity command first.");
        await write({ input: { ...input, operation }, operation, finished: false });
      }),
    complete: (requestId: string) =>
      ordered(async () => {
        const current = await read();
        if (current.operation?.body.request_id !== requestId)
          throw Error("The original activity command changed. Refresh saved history.");
        await write({ input: null, operation: null, finished: true });
      }),
    retire: () =>
      ordered(async () => {
        await write({ input: null, operation: null, finished: true });
      }),
    reset: () =>
      ordered(async () => {
        await write({ input: null, operation: null, finished: false });
      }),
  };
}

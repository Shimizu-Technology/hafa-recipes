import { draftKey, type Storage } from "./drafts";

export interface PrivateForm<T, C> {
  version: 1;
  input: T | null;
  command: C | null;
  terminal: boolean;
  removed: boolean;
  saved_id?: string;
}
const queues = new Map<string, Promise<unknown>>();
const removedScopes = new Set<string>();
const removedBox = <T, C>(): PrivateForm<T, C> => ({
  version: 1,
  input: null,
  command: null,
  terminal: true,
  removed: true
});
const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** One original command survives retry; terminal boxes fence late autosaves. */
export function createPrivateForm<T, C>(storage: Storage, owner: string, scope: string) {
  const key = draftKey(owner, scope);
  function ordered<R>(work: () => Promise<R>) {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    queues.set(key, next);
    void next
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
  async function read(): Promise<PrivateForm<T, C>> {
    if (removedScopes.has(key)) return removedBox();
    const raw = await storage.getItem(key);
    if (removedScopes.has(key)) return removedBox();
    if (!raw) return { version: 1, input: null, command: null, terminal: false, removed: false };
    const value = JSON.parse(raw);
    if (value.version === 1 && "terminal" in value) {
      if (value.removed) {
        removedScopes.add(key);
        return removedBox();
      }
      return value;
    }
    // Existing device drafts, including a pending measurement operation.
    return { version: 1, input: value, command: value.operation ?? null, terminal: false, removed: false };
  }
  const write = async (value: PrivateForm<T, C>) => {
    const guard = () => {
      if (removedScopes.has(key) && !value.removed)
        throw Error("This record was removed. Its previous draft cannot be restored.");
    };
    guard();
    await storage.setItem(key, JSON.stringify(value));
    guard();
  };
  return {
    load: () => ordered(read),
    save(input: T) {
      const frozen = snapshot(input);
      return ordered(async () => {
        const box = await read();
        if (box.terminal || box.command) return false;
        await write({ ...box, input: frozen });
        return true;
      });
    },
    begin(input: T | null, command: C) {
      const frozenInput = snapshot(input),
        frozenCommand = snapshot(command);
      return ordered(async () => {
        const box = await read();
        if (box.terminal) throw Error("This draft is complete. Open the saved record or start a new draft.");
        if (box.command && JSON.stringify(box.command) !== JSON.stringify(frozenCommand))
          throw Error("Retry these saved details or reload the saved record before editing.");
        // A removal can retain its exact replay command without retaining private input.
        await write({
          ...box,
          input: frozenInput === null ? null : box.command ? box.input : frozenInput,
          command: frozenCommand
        });
        return frozenCommand;
      });
    },
    complete(command: C, saved_id?: string, removed = false) {
      const frozen = snapshot(command);
      return ordered(async () => {
        const box = await read();
        if (box.removed) throw Error("This record was removed. Its previous draft cannot be restored.");
        if (JSON.stringify(box.command) !== JSON.stringify(frozen))
          throw Error("The saved draft changed. Reload the saved record before continuing.");
        await write({ version: 1, input: null, command: null, terminal: true, removed, saved_id });
      });
    },
    retire: () => {
      // Fence immediately, even if an earlier queued write or durable removal fails.
      removedScopes.add(key);
      return ordered(() => write(removedBox()));
    },
    reset: () =>
      ordered(async () => {
        const box = await read();
        if (box.removed) throw Error("This record was removed. Its previous draft cannot be restored.");
        await write({ version: 1, input: null, command: null, terminal: false, removed: false });
      })
  };
}

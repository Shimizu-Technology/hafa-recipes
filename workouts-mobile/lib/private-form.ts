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

export interface PrivateDraftSnapshot<T> {
  value: T | null;
  revision: string | null;
}
const draftRevisions = new Map<string, string | null>();
const draftListeners = new Map<string, Set<() => void>>();
const revisionField = "_capture_revision";
/** Capture, sharing and import retirement compare/write the same plain draft slot. */
export function createPrivateDraftSlot<T extends object>(
  storage: Storage,
  owner: string,
  scope: string,
  revision: () => string
) {
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
  function publish(value: string | null) {
    if (draftRevisions.has(key) && draftRevisions.get(key) === value) return;
    draftRevisions.set(key, value);
    for (const listener of draftListeners.get(key) ?? []) listener();
  }
  async function read(guard: () => void): Promise<PrivateDraftSnapshot<T>> {
    guard();
    const raw = await storage.getItem(key);
    guard();
    if (!raw) {
      publish(null);
      return { value: null, revision: null };
    }
    const value = JSON.parse(raw) as T & { _capture_revision?: string };
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Could not restore this source. Reload the saved source before editing.");
    // Upgrade legacy plain drafts atomically without changing their top-level files.
    const validToken = typeof value[revisionField] === "string" && !!value[revisionField];
    const token = validToken ? value[revisionField]! : revision();
    if (!validToken) {
      guard();
      await storage.setItem(key, JSON.stringify({ ...value, [revisionField]: token }));
      guard();
    }
    publish(token);
    return { value: { ...value, [revisionField]: token }, revision: token };
  }
  return {
    load: (guard: () => void) => ordered(() => read(guard)),
    assertCurrent(expected: string | null) {
      if (draftRevisions.has(key) && draftRevisions.get(key) !== expected)
        throw Error("A newer source is saved. Load it before changing this draft.");
    },
    subscribe(listener: () => void) {
      const listeners = draftListeners.get(key) ?? new Set();
      listeners.add(listener);
      draftListeners.set(key, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) draftListeners.delete(key);
      };
    },
    save(expected: string | null, value: T, guard: () => void) {
      const frozen = snapshot(value);
      return ordered(async () => {
        const prior = await read(guard);
        if (prior.revision !== expected)
          throw Object.assign(Error("A newer source is saved. Load it before changing this draft."), {
            captureDraftConflict: true
          });
        const token = revision(),
          next = { ...frozen, [revisionField]: token };
        guard();
        try {
          await storage.setItem(key, JSON.stringify(next));
        } catch (error) {
          let committed: boolean;
          try {
            const raw = await storage.getItem(key);
            committed = !!raw && JSON.parse(raw)?._capture_revision === token;
          } catch {
            throw Object.assign(
              Error("Could not confirm that source save. Reload the saved source before trying again."),
              { captureRegistrationUncertain: true }
            );
          }
          if (!committed) throw error;
        }
        // Return the committed receipt even if the caller's view changed during
        // IO. The caller must not mistake a registered file for an orphan.
        publish(token);
        return { value: next, revision: token };
      });
    },
    remove(expected: string | null, guard: () => void) {
      return ordered(async () => {
        const prior = await read(guard);
        if (prior.revision !== expected) return null;
        guard();
        await storage.removeItem(key);
        publish(null);
        return prior.value;
      });
    }
  };
}

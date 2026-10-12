import type { Storage } from "./drafts";
import type { QueryClient } from "@tanstack/react-query";

// Deliberately outside the private namespaces removed by device/account cleanup.
export const logoutRecoveryPrefix = "hafa-workouts:acknowledged-logout:v1:";
export interface LogoutAcknowledgement {
  version: 1;
  owner: string;
  binding: string;
  subject: string;
  sessionId: string;
}
export interface LogoutAuth {
  loaded: boolean;
  binding: string | null;
  subject: string | null;
  sessionId: string | null;
}
export function logoutBinding(environment: string | undefined, key: string, subject: string) {
  return `${environment}:${key}:${subject}`;
}
export function logoutRecoveryKey(binding: string) {
  return logoutRecoveryPrefix + encodeURIComponent(binding);
}
export function clearLogoutQueries(cache: QueryClient, record: LogoutAcknowledgement) {
  cache.removeQueries({ predicate: (query) => query.queryKey[0] === record.owner ||
    (query.queryKey[0] === "identity" && query.queryKey[1] === record.binding) });
}
function checked(value: unknown): LogoutAcknowledgement {
  const record = value as LogoutAcknowledgement;
  if (!record || record.version !== 1 ||
      ![record.owner, record.binding, record.subject, record.sessionId].every((v) => typeof v === "string" && v.length > 0 && v.length <= 2000))
    throw Error("The saved account sign-out needs support before private training can open.");
  return { version: 1, owner: record.owner, binding: record.binding, subject: record.subject, sessionId: record.sessionId };
}
export interface LogoutRecoveryState {
  ready: boolean;
  records: readonly LogoutAcknowledgement[];
  busy: string | null;
  error: string;
}
export function createLogoutRecovery(deps: {
  storage: Storage & { getAllKeys(): Promise<readonly string[]> };
  cleanup(owner: string, binding: string): Promise<void>;
}) {
  let state: LogoutRecoveryState = { ready: false, records: [], busy: null, error: "" };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;
  let work: Promise<void> | null = null;
  const writes = new Map<string, Promise<void>>();
  const emit = (patch: Partial<LogoutRecoveryState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  async function persist(record: LogoutAcknowledgement) {
    await deps.storage.setItem(logoutRecoveryKey(record.binding), JSON.stringify(record));
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate() {
      if (state.ready) return Promise.resolve();
      if (loading) return loading;
      loading = (async () => {
        try {
          const records = [...state.records];
          for (const key of await deps.storage.getAllKeys()) {
            if (!key.startsWith(logoutRecoveryPrefix)) continue;
            const raw = await deps.storage.getItem(key);
            if (!raw) continue;
            const record = checked(JSON.parse(raw));
            if (key !== logoutRecoveryKey(record.binding)) throw Error("Invalid sign-out recovery binding.");
            if (!records.some((item) => item.binding === record.binding)) records.push(record);
          }
          emit({ ready: true, records, error: "" });
        } catch {
          emit({ error: "Could not restore account sign-out recovery. Retry before opening private training." });
        } finally { loading = null; }
      })();
      return loading;
    },
    // This is called only after the delete API acknowledged the original account.
    // Publish the barrier and clear private queries before any awaited native I/O.
    async acknowledge(value: LogoutAcknowledgement, clearPrivate: (record: LogoutAcknowledgement) => void) {
      const record = checked(value);
      // Register the pending write before publishing: a synchronous subscriber
      // may immediately start recovery, which must wait for this original write.
      const pending = Promise.resolve().then(() => persist(record));
      writes.set(record.binding, pending);
      void pending.catch(() => undefined);
      emit({ records: [...state.records.filter((item) => item.binding !== record.binding), record], error: "" });
      try { clearPrivate(record); await pending; }
      catch {
        emit({ error: "Your server account was deleted. The sign-out acknowledgement still needs saving on this device. Retry cleanup and sign-out; do not delete again." });
        throw Error(state.error);
      }
    },
    retry(record: LogoutAcknowledgement, ops: {
      auth(): LogoutAuth;
      clearPrivate(record: LogoutAcknowledgement): void;
      signOut(options: { sessionId: string }): Promise<void>;
    }) {
      if (work) return work;
      if (!state.records.some((item) => item.binding === record.binding)) return Promise.resolve();
      emit({ busy: record.binding, error: "" });
      work = (async () => {
        let stage: "acknowledgement" | "cleanup" | "signout" | "completion" = "acknowledgement";
        try {
          // A previous ACK write may have failed. Never invoke the SDK before it is durable.
          await writes.get(record.binding)?.catch(() => undefined);
          await persist(record);
          ops.clearPrivate(record);
          stage = "cleanup";
          await deps.cleanup(record.owner, record.binding);
          stage = "signout";
          const auth = ops.auth();
          if (!auth.loaded) throw Error("Wait for your sign-in state, then retry cleanup and sign-out.");
          if (auth.subject === record.subject && auth.binding === record.binding && auth.sessionId === record.sessionId) {
            // Explicit original session + a fresh subject check: never default to another account's session.
            await ops.signOut({ sessionId: record.sessionId });
            const after = ops.auth();
            // The SDK promise can settle before its hooks publish. Keep private
            // routes closed until fresh auth confirms that the session is gone.
            if (!after.loaded || (after.subject === record.subject && after.binding === record.binding && after.sessionId === record.sessionId)) return;
          } else if (auth.subject && (auth.subject !== record.subject || auth.binding !== record.binding)) {
            // Preserve another account's session. Keep the ACK for the original binding.
            return;
          }
          stage = "completion";
          await deps.storage.removeItem(logoutRecoveryKey(record.binding));
          writes.delete(record.binding);
          emit({ records: state.records.filter((item) => item.binding !== record.binding) });
        } catch {
          const message = stage === "acknowledgement" ? "The sign-out acknowledgement still needs saving on this device." :
            stage === "cleanup" ? "This device still needs private data cleanup." :
            stage === "signout" ? "Sign-out did not finish on this device." : "This device still needs to finish account recovery.";
          emit({ error: `Your server account was deleted. ${message} Retry cleanup and sign-out; do not delete again.` });
        } finally { emit({ busy: null }); work = null; }
      })();
      return work;
    },
  };
}
export type LogoutRecovery = ReturnType<typeof createLogoutRecovery>;

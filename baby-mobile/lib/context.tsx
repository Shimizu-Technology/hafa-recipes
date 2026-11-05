import {
  installRoutineSnapshot,
  readAllRoutines,
  routineReminderScope,
  routineStateChanged,
  trackRoutineIntents,
} from "./routine-sync";
import { importFinished } from "./import-status";
import { openingAccount } from "./startup";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Platform } from "react-native";
import { useAuth, useClerk } from "@clerk/expo";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import NetInfo from "@react-native-community/netinfo";
import { configuration } from "./config";
import { ApiError, createBabyApi, type BabyApi } from "./api";
import { createVault, storageKey, type SecretStorage } from "./vault";
import { createDeviceVault } from "./device-vault";
import {
  emptyState,
  messageFor,
  type BabyRecord,
  type Bootstrap,
  type DeviceState,
  type EditorDraft,
  type Child,
  type Mutation,
} from "./models";
import {
  addMutation,
  fencedState,
  heldUntil,
  mutationRecordId,
  settledSplit,
  pendingRecords,
  replaceRecord,
  shouldRetry,
  advancePending,
  advanceAfterImport,
  birthStep,
  feedEdit,
  finishedFeedNotice,
  plainFeedNotice,
  rejectedAction,
  removedFeedNotice,
  producedRevision,
  removedSessionNotice,
  retriedSave,
  retryLater,
  switchTooLate,
  unresolvedAttempts,
  queueRemovedUploads,
  uploadedReferences,
  waitingForEarlier,
  waitingForImport,
  withNotice,
  withPendingBirths,
  withSettled,
  withoutBirth,
  withoutChain,
} from "./outbox";
import { revokeShareSession } from "./share-session-state";
import { clearPendingShares } from "../modules/hafa-baby-share/src";
import { clearFiles, removeLocal, uploadFile } from "./files";
import { clearReminders, reconcileReminders } from "./reminders";
const webMemory = new Map<string, string>();
const secret: SecretStorage =
  Platform.OS === "web"
    ? {
        getItemAsync: async (k) => webMemory.get(k) ?? null,
        setItemAsync: async (k, v) => {
          webMemory.set(k, v);
        },
        deleteItemAsync: async (k) => {
          webMemory.delete(k);
        },
      }
    : {
        getItemAsync: SecureStore.getItemAsync,
        setItemAsync: (k, v) =>
          SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        deleteItemAsync: SecureStore.deleteItemAsync,
      };
interface BabyContext {
  api: BabyApi;
  owner: string;
  state: DeviceState;
  records: BabyRecord[];
  ready: boolean;
  error: string;
  syncing: boolean;
  online: boolean;
  /** The last sync or refresh couldn't reach Håfa. Nothing has gone wrong with her work, which waits on this phone. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
  commit: (change: (s: DeviceState) => DeviceState) => Promise<void>;
  queue: (m: Mutation) => Promise<void>;
  /** Takes later queued changes to the same record with it. `server` is the record as read just now: null if it's gone. `child` is the same for a birth change. */
  discardQueued: (id: string, server?: BabyRecord | null, child?: Child) => Promise<void>;
  saveDraft: (key: string, draft: EditorDraft | null, valid?: () => boolean) => Promise<void>;
  getToken: () => Promise<string | null>;
  current: () => boolean;
  signOut: () => Promise<void>;
  erase: () => Promise<void>;
  enroll: () => Promise<void>;
}
const Context = createContext<BabyContext | null>(null);
export function useBaby() {
  const context = useContext(Context);
  if (!context) throw Error("Baby account unavailable");
  return context;
}
export function BabyProvider({ children }: PropsWithChildren) {
  const { getToken, userId } = useAuth(),
    clerk = useClerk(),
    token = useRef(getToken);
  token.current = getToken;
  const binding = `${configuration.clerkEnvironment}:${configuration.clerkKey}:${userId}`,
    alive = useRef(true),
    liveBinding = useRef(binding);
  liveBinding.current = binding;
  const current = () => alive.current && liveBinding.current === binding;
  const api = useMemo(() => createBabyApi(configuration.apiBase, () => token.current(), current), [binding]);
  const identityVault = useMemo(() => createVault(secret, "identity:" + binding, Crypto.randomUUID), [binding]);
  const [owner, setOwner] = useState(""),
    [state, setState] = useState<DeviceState>(emptyState),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [syncing, setSyncing] = useState(false),
    [online, setOnline] = useState(true),
    [unreachable, setUnreachable] = useState(false);
  const ref = useRef(state),
    vault = useRef<ReturnType<typeof createDeviceVault> | null>(null),
    serialized = useRef<Promise<unknown>>(Promise.resolve()),
    busy = useRef(false),
    rerun = useRef(false),
    onlineRef = useRef(true),
    ownerRef = useRef(""),
    storageReady = useRef(false),
    deleting = useRef(false),
    closing = useRef(false),
    routineVersion = useRef(0),
    restoringRoutines = useRef<Promise<void> | null>(null),
    heldSync = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    initializer = useRef<() => Promise<void>>(async () => {});
  const commit = (change: (s: DeviceState) => DeviceState, lease = api.lease()): Promise<void> => {
    const next = serialized.current
      .catch(() => undefined)
      .then(async () => {
        if (!current() || closing.current || !vault.current) throw Error("Your account changed.");
        if (!storageReady.current)
          throw Error("Restore your private device data before saving. Existing files have not been overwritten.");
        api.assertLease(lease);
        const before = ref.current;
        const value = withPendingBirths(trackRoutineIntents(before, change(before), ownerRef.current));
        if (deleting.current && value.bootstrap) throw Error("Baby data deletion is in progress.");
        if (value.outbox.some((m) => m.generation !== value.bootstrap?.generation))
          throw Error("Older changes cannot be saved after Baby data is cleared.");
        if (value.bootstrap?.active === false && (value.outbox.length || Object.keys(value.drafts).length))
          throw Error("Start a new Baby space deliberately before saving.");
        await vault.current.write(value);
        api.assertLease(lease);
        if (!current() || closing.current) return;
        if (routineStateChanged(before, value)) routineVersion.current++;
        ref.current = value;
        setState(value);
      });
    serialized.current = next;
    return next;
  };
  async function restoreRoutines() {
    if (restoringRoutines.current) return restoringRoutines.current;
    const capturedOwner = ownerRef.current,
      generation = ref.current.bootstrap?.generation,
      lease = api.lease(),
      version = routineVersion.current;
    const valid = () =>
      current() &&
      !closing.current &&
      !deleting.current &&
      storageReady.current &&
      ownerRef.current === capturedOwner &&
      !!capturedOwner &&
      generation !== undefined &&
      ref.current.bootstrap?.generation === generation &&
      ref.current.bootstrap.active !== false &&
      api.lease() === lease &&
      routineVersion.current === version;
    if (!valid()) return;
    const work = (async () => {
      const rows = await readAllRoutines((filters) => api.records(filters), valid);
      if (!rows || !valid()) return;
      await commit((s) => (valid() ? installRoutineSnapshot(s, rows, capturedOwner) : s), lease);
    })();
    restoringRoutines.current = work;
    try {
      await work;
    } finally {
      if (restoringRoutines.current === work) restoringRoutines.current = null;
    }
  }
  async function mergeBootstrap(bootstrap: Bootstrap) {
    if (!current() || closing.current || deleting.current) return false;
    const lease = api.lease();
    if (
      bootstrap.active === false ||
      (ref.current.bootstrap && ref.current.bootstrap.generation !== bootstrap.generation) ||
      (ref.current.routine_sync && ref.current.routine_sync.generation !== bootstrap.generation)
    ) {
      setReady(false);
      clearPendingShares();
      await clearReminders(ownerRef.current);
      await clearFiles(ownerRef.current);
    }
    await commit((s) => {
      const next = fencedState(s, bootstrap.generation);
      return {
        ...next,
        bootstrap,
        selectedChild: bootstrap.children.some((child) => child.id === next.selectedChild) ? next.selectedChild : null,
      };
    }, lease);
    if (!current() || closing.current || deleting.current) return false;
    setReady(true);
    return true;
  }
  function noteFailure(e: unknown) {
    setUnreachable(e instanceof ApiError && e.status === 0);
    setError(messageFor(e));
  }
  async function refresh(opening = false) {
    try {
      if (deleting.current) return;
      if (closing.current) {
        if (vault.current) await signOut();
        else await initializer.current();
        return;
      }
      if (!vault.current) {
        await initializer.current();
        return;
      }
      if (!storageReady.current) {
        if (!vault.current) throw Error("Connect once to restore your private account before retrying.");
        const saved = await vault.current.read<DeviceState>();
        if (!current() || closing.current || deleting.current) return;
        if (saved) {
          ref.current = saved;
          setState(saved);
        }
        storageReady.current = true;
        setReady(true);
      }
      const fresh = await api.bootstrap();
      if (!current() || closing.current || deleting.current) return;
      const old = ref.current.bootstrap?.generation;
      if (!(await mergeBootstrap(fresh))) return;
      setError("");
      if (old !== undefined && old !== fresh.generation) await clearReminders(ownerRef.current);
      if (fresh.active === false) return;
      const lease = api.lease();
      const page = await api.records({ limit: 100 });
      const recent = page.items.filter((r) => r.kind !== "routine");
      await commit(
        (s) => ({
          ...s,
          records: [...recent, ...s.records.filter((r) => !recent.some((f) => f.id === r.id))],
        }),
        lease
      );
      await restoreRoutines();
      setError("");
    } catch (e) {
      if (opening) throw e;
      if (alive.current) noteFailure(e);
    }
  }
  async function sync() {
    // A change queued mid-sync (for example Undo right after a quick log) runs on the next pass.
    if (busy.current) rerun.current = true;
    if (
      deleting.current ||
      closing.current ||
      busy.current ||
      !alive.current ||
      !onlineRef.current ||
      AppState.currentState === "background" ||
      !ref.current.bootstrap ||
      ref.current.bootstrap.active === false
    )
      return;
    busy.current = true;
    setSyncing(true);
    let restoreAfterSync = false;
    try {
      const latest = await api.bootstrap();
      if (!(await mergeBootstrap(latest))) return;
      if (alive.current) setError("");
      if (latest.active === false) return;
      restoreAfterSync = true;
      let serverChildren = latest.children;
      for (const pending of [...ref.current.outbox]) {
        const next = ref.current.outbox.find((m) => m.id === pending.id);
        if (!next) continue;
        if (!alive.current || !onlineRef.current) break;
        if (next.generation !== latest.generation || next.conflict || next.error || next.localOnly) continue;
        if (next.type === "import" && next.automatic &&
          (!(latest.profile.ai_consent && latest.profile.auto_process_shares) ||
            (next.automatic_epoch ?? 0) !== (latest.profile.auto_process_epoch ?? 0))) {
          // The preceding original-save mutation remains. A later opt-in must
          // not resurrect an automatic provider request that was withdrawn.
          await commit((s) => ({ ...s, outbox: s.outbox.filter((m) => m.id !== next.id) }));
          continue;
        }
        if (heldUntil(next) || waitingForEarlier(ref.current.outbox, next) || waitingForImport(ref.current.imports, next)) continue;
        try {
          let result: BabyRecord | undefined;
          if (next.type === "event_split") {
            let done: Awaited<ReturnType<typeof api.splitEvent>>;
            try {
              done = await api.splitEvent(next.series.id, { revision: next.series.revision ?? 0, from_start: next.from_start, event: next.event }, next.generation);
            } catch (failure) {
              if (!(failure instanceof ApiError) || failure.local || !current() || (failure.status !== 409 && failure.status !== 410)) throw failure;
              // Gone means it landed once and the new event was removed since. Refused means nothing changed: the old dates all stay.
              await commit((s) => ({ ...s, outbox: failure.status === 410 ? s.outbox.filter((m) => m.id !== next.id)
                : s.outbox.map((m) => (m.id === next.id ? { ...m, conflict: true, error: "This event changed somewhere else, so nothing was changed. Discard this and make your change again." } : m)) }));
              continue;
            }
            await commit((s) => ({ ...s, settled: withSettled(s, next.id, settledSplit(next)).settled,
              records: replaceRecord(done.series ? replaceRecord(s.records, done.series) : s.records.filter((r) => r.id !== next.series.id), done.event),
              outbox: s.outbox.filter((m) => m.id !== next.id).map((m) => {
                const moved = done.series ? advancePending(m, next, done.series) : m;
                return advancePending(moved, next, done.event);
              }) }));
            continue;
          } else if (next.type === "delete") {
            await api.remove(next.record, next.generation);
          } else if (next.type === "child_birth") {
            const server = serverChildren.find((child) => child.id === next.child_id), step = birthStep(server, next);
            if (step === "gone" || step === "different") {
              await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id !== next.id ? m : { ...m,
                error: step === "gone" ? "This baby’s profile was removed." : "Another phone saved a different birth date. Discard this to keep that one." })) }));
              continue;
            }
            let taken = false;
            await commit((s) => {
              taken = s.outbox.some((m) => m.id === next.id);
              return { ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type === "child_birth" ? { ...m, sent: true } : m)) };
            });
            if (!taken) continue;
            let saved = server!;
            if (step === "send") {
              try {
                saved = await api.child({ id: server!.id, birth_date: next.birth_date, revision: server!.revision }, next.generation);
              } catch (failure) {
                if (!(failure instanceof ApiError && !failure.local && failure.status === 409) || !current()) throw failure;
                // Something else on this child moved. The next pass reads it again and sends the date at its new revision.
                await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type === "child_birth" ? retryLater(m) : m)) }));
                continue;
              }
              serverChildren = serverChildren.map((child) => (child.id === saved.id ? saved : child));
            }
            await commit((s) => ({ ...s, outbox: s.outbox.filter((m) => m.id !== next.id),
              bootstrap: s.bootstrap && { ...s.bootstrap, children: s.bootstrap.children.map((child) => (child.id === saved.id ? saved : child)) } }));
            continue;
          } else if (next.type === "feed_action" || next.type === "session_action") {
            // Once the request begins the API may have it, whatever comes back. Undo sees this before it can take it back.
            let taken = false;
            await commit((s) => {
              taken = s.outbox.some((m) => m.id === next.id);
              return { ...s, outbox: s.outbox.map((m) => (m.id === next.id && (m.type === "feed_action" || m.type === "session_action") ? { ...m, sent: true } : m)) };
            });
            if (!taken) continue;
            try {
              result = next.type === "feed_action"
                ? await api.feedAction(next.record_id, next.action, next.generation)
                : await api.sessionAction(next.record_id, next.action, next.generation);
            } catch (failure) {
              if (!(failure instanceof ApiError && !failure.local && (failure.status === 404 || failure.status === 409)) || !current()) throw failure;
              let row: BabyRecord | null = null;
              try { row = await api.record(next.record_id); }
              catch (reading) {
                if (!(reading instanceof ApiError && !reading.local && reading.status === 404)) throw reading;
              }
              const outcome = rejectedAction(row, next.action);
              if (outcome === "unresolved") {
                // The feed still takes taps, so this was a passing race. It's kept, and asks her if it doesn't clear.
                const tries = (next.attempts ?? 0) + 1;
                await commit((s) => ({ ...s, records: row ? replaceRecord(s.records, row) : s.records,
                  outbox: s.outbox.map((m) => m.id !== next.id || (m.type !== "feed_action" && m.type !== "session_action") ? m
                    : tries >= unresolvedAttempts ? { ...m, error: "This tap couldn’t be added to the feed. It’s safe on this phone." } : retryLater(m)) }));
                continue;
              }
              await commit((s) => ({ ...(outcome === "applied" ? s : withNotice(s, outcome === "plain" ? plainFeedNotice : next.type === "feed_action" ? removedFeedNotice : removedSessionNotice)),
                settled: withSettled(s, next.id, outcome === "applied" && row ? { made: producedRevision(next, row) } : {}).settled,
                records: row ? replaceRecord(s.records, row) : s.records.filter((r) => r.id !== next.record_id),
                outbox: s.outbox.filter((m) => m.id !== next.id).map((m) => (row && outcome === "applied" ? advancePending(m, next, row) : m)),
              }));
              continue;
            }
          } else {
            let files = next.files.map((f) => ({
              ...f,
              uploaded_id: f.uploaded_id ?? ref.current.fileUploads?.[f.id],
            }));
            for (const file of files) {
              if (file.uploaded_id) continue;
              const uploaded = await uploadFile(api, file, next.generation);
              files = files.map((f) => (f.id === file.id ? { ...f, uploaded_id: uploaded.id } : f));
              await commit((s) => ({
                ...s,
                fileUploads: { ...s.fileUploads, [file.id]: uploaded.id },
                outbox: s.outbox.map((m) => (m.id === next.id && m.type !== "delete" ? { ...m, files } : m)),
              }));
            }
            const attachment_ids = [
              ...(next.type === "import" ? (next.attachment_ids ?? []) : []),
              ...files.map((f) => f.uploaded_id!).filter(Boolean),
            ];
            if (next.type === "save") {
              const value = {
                ...next.record,
                data: {
                  ...next.record.data,
                  ...(attachment_ids.length
                    ? { attachment_ids: [...new Set([...(next.record.data.attachment_ids ?? []), ...attachment_ids])] }
                    : {}),
                },
              };
              result = await api.save(feedEdit(value), next.generation);
            } else {
              // Persist before the request: a lost admission response can replay
              // an already-completed job after a relaunch.
              const baseline = next.baseline === undefined
                ? ref.current.records.find(row => row.id === next.record_id) ?? null : next.baseline;
              if (next.baseline === undefined) await commit(s => ({ ...s,
                outbox: s.outbox.map(m => m.id === next.id ? { ...m, baseline } : m),
              }));
              const job = await api.import(
                {
                  id: next.id,
                  ...(next.automatic ? { automatic: true, automatic_epoch: next.automatic_epoch ?? 0 } : {}),
                  record_id: next.record_id,
                  url: next.url,
                  text: next.text,
                  child_id: next.child_id,
                  topics: next.topics,
                  attachment_ids,
                },
                next.generation
              );
              await commit((s) => ({ ...s, imports: [{ ...job, baseline, automatic: next.automatic, reconciled: false },
                ...s.imports.filter((j) => j.id !== job.id)] }));
            }
          }
          await commit((s) => ({
            ...(next.type === "feed_action" && result && switchTooLate(next.action, result) ? withNotice(s, finishedFeedNotice) : s),
            ...(result ? { settled: withSettled(s, next.id, { made: producedRevision(next, result) }).settled } : {}),
            records: result
              ? replaceRecord(s.records, result)
              : next.type === "delete"
                ? s.records.filter((r) => r.id !== next.record.id)
                : s.records,
            outbox: s.outbox.filter((m) => m.id !== next.id).map((m) => (result ? advancePending(m, next, result) : m)),
          }));
          // Uploaded originals stay in this private device container until explicit device cleanup.
          // A reopened offline draft may still reference them while its ancestor is syncing.
        } catch (e) {
          if (!alive.current) break;
          if (e instanceof ApiError && e.local) break;
          const status = e instanceof ApiError ? e.status : -1;
          if (status === 410) {
            await refresh();
            break;
          }
          if (status === 0 || status === 401) {
            noteFailure(e);
            break;
          }
          if ((next.type === "feed_action" || next.type === "session_action" || next.type === "child_birth" || next.type === "event_split" || retriedSave(next)) && shouldRetry(status)) {
            await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type !== "delete" && m.type !== "import" ? retryLater(m) : m)) }));
            continue;
          }
          await commit((s) => ({
            ...s,
            outbox: s.outbox.map((m) =>
              m.id === next.id ? { ...m, error: messageFor(e), conflict: status === 409 } : m
            ),
          }));
        }
      }
      for (const id of ref.current.fileReleases ?? []) {
        if (uploadedReferences(ref.current).has(id)) continue;
        await api.releaseAttachment(id, latest.generation);
        await commit((s) => ({
          ...s,
          fileReleases: (s.fileReleases ?? []).filter((pending) => pending !== id),
          fileUploads: Object.fromEntries(Object.entries(s.fileUploads).filter(([, uploaded]) => uploaded !== id)),
        }));
      }
      for (const job of [...ref.current.imports])
        if (job.status !== "deferred" && (!importFinished(job.status) || !job.reconciled)) {
          try {
            const fresh = importFinished(job.status) ? job : { ...await api.job(job.id), baseline: job.baseline, automatic: job.automatic };
            let row: BabyRecord | undefined;
            if (fresh.record_id) {
              try { row = await api.record(fresh.record_id); }
              catch (failure) {
                if (!(failure instanceof ApiError && failure.status === 404)) throw failure;
              }
            }
            // A terminal job and its refreshed source become durable together.
            // A failed fetch leaves the previous polling obligation intact.
            await commit((s) => ({ ...s,
              imports: s.imports.map((j) => (j.id === fresh.id ? { ...fresh, reconciled: importFinished(fresh.status) } : j)),
              records: row ? replaceRecord(s.records, row) : s.records,
              // Held edits use the import's final revision. Rejected edits still need review.
              outbox: row && importFinished(fresh.status)
                ? s.outbox.map(m => m.type === "save" && !m.error && !m.conflict ? advanceAfterImport(m, row!, fresh) : m)
                : s.outbox,
            }));
            if (row && importFinished(fresh.status) && ref.current.outbox.some(m =>
              m.type === "save" && m.record.id === row!.id && !m.error && !m.conflict && !m.localOnly))
              rerun.current = true;
          } catch {
            /* The next foreground attempt retries persisted jobs. */
          }
        }
    } catch (e) {
      if (current()) noteFailure(e);
    } finally {
      // A failed upload/release must not leave reminders stale on every subsequent sync.
      if (restoreAfterSync) {
        try {
          await restoreRoutines();
        } catch (e) {
          if (current()) setError(messageFor(e));
        }
      }
      busy.current = false;
      if (alive.current) setSyncing(false);
      // Come back for anything still inside its Undo window, not only on the next 15-second pass.
      const held = ref.current.outbox.map((change) => heldUntil(change)).filter(Boolean);
      clearTimeout(heldSync.current);
      if (held.length && alive.current)
        heldSync.current = setTimeout(() => void funcs.current.sync(), Math.max(0, Math.min(...held) - Date.now()) + 50);
      if (rerun.current && alive.current) {
        rerun.current = false;
        void funcs.current.sync();
      }
    }
  }
  const funcs = useRef({ refresh, sync });
  funcs.current = { refresh, sync };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const initialize = async () => {
      try {
        const cleanupKey = storageKey(binding) + ".cleanup";
        const cleaning = await secret.getItemAsync(cleanupKey);
        if (cancelled || !current()) return;
        if (cleaning) {
          closing.current = true;
          setReady(false);
          await revokeShareSession();
          clearPendingShares();
          await clearReminders(cleaning);
          await clearFiles(cleaning);
          await createDeviceVault(secret, "data:" + cleaning + ":" + binding, Crypto.randomUUID).clear();
          await identityVault.clear();
          if (cancelled || !current()) return;
          await clerk.signOut();
          await secret.deleteItemAsync(cleanupKey);
          return;
        }
        let identity: { id: string } | null = null;
        try {
          identity = await openingAccount(() => api.identity(), () => !cancelled && current());
          await identityVault.write(identity);
        } catch (e) {
          if (e instanceof ApiError && !shouldRetry(e.status)) throw e;
          identity = await identityVault.read<{ id: string }>();
        }
        if (!identity) throw Error("Connect once to open your private Baby account.");
        if (cancelled) return;
        ownerRef.current = identity.id;
        setOwner(identity.id);
        vault.current = createDeviceVault(secret, "data:" + identity.id + ":" + binding, Crypto.randomUUID);
        const saved = await vault.current.read<DeviceState>();
        if (cancelled) return;
        storageReady.current = true;
        closing.current = false;
        if (saved) {
          ref.current = saved;
          setState(saved);
        }
        setReady(true);
        await openingAccount(() => funcs.current.refresh(true), () => !cancelled && current());
        await funcs.current.sync();
      } catch (e) {
        if (!cancelled) setError(messageFor(e));
      }
    };
    initializer.current = initialize;
    void initialize();
    const app = AppState.addEventListener("change", (status) => {
      if (status === "active") void funcs.current.sync();
    });
    const net = NetInfo.addEventListener((network) => {
      const on = network.isConnected !== false && network.isInternetReachable !== false;
      onlineRef.current = on;
      setOnline(on);
      if (on) void funcs.current.sync();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void funcs.current.sync();
    }, 15000);
    return () => {
      cancelled = true;
      alive.current = false;
      vault.current?.retire();
      identityVault.retire();
      app.remove();
      net();
      clearInterval(timer);
      clearTimeout(heldSync.current);
    };
  }, [binding]);
  useEffect(() => {
    let cancelled = false;
    const lease = api.lease();
    if (ready && owner && state.bootstrap && !closing.current && state.bootstrap.active !== false)
      void reconcileReminders(owner, state.bootstrap.generation, pendingRecords(state), {
        ...routineReminderScope(state, owner),
        current: () =>
          !cancelled &&
          current() &&
          !closing.current &&
          !deleting.current &&
          ownerRef.current === owner &&
          api.lease() === lease,
      }).catch(() => {
        if (!cancelled && current())
          setError(
            "Your entries are saved, but reminders need another attempt. Open Routines or check notification settings."
          );
      });
    return () => {
      cancelled = true;
    };
  }, [state, owner, ready]);
  async function clean() {
    await revokeShareSession();
    clearPendingShares();
    await clearReminders(ownerRef.current);
    await clearFiles(ownerRef.current);
    await vault.current?.clear();
    await identityVault.clear();
    ref.current = emptyState();
    setState(emptyState());
  }
  async function signOut() {
    closing.current = true;
    setReady(false);
    const key = storageKey(binding) + ".cleanup";
    try {
      await secret.setItemAsync(key, ownerRef.current);
      if (!current()) return;
      await clean();
      if (!current()) return;
      await clerk.signOut();
      await secret.deleteItemAsync(key);
    } catch (e) {
      if (current()) setError("Device cleanup or sign-out needs another attempt. Your private space stays closed.");
      throw e;
    }
  }
  return (
    <Context.Provider
      value={{
        api,
        owner,
        state,
        records: pendingRecords(state),
        ready,
        error,
        syncing,
        online,
        unreachable: unreachable && !!error,
        refresh,
        sync,
        commit,
        current,
        getToken: () => token.current(),
        discardQueued: async (id, server, child) => {
          await commit((s) => {
            if (busy.current) throw Error("Wait for the current sync to finish before discarding a queued change.");
            const removed = s.outbox.find((m) => m.id === id);
            if (!removed) return s;
            const left = withoutChain(s, removed, server);
            return removed.type === "child_birth" ? withoutBirth(left, removed, child) : left;
          });
          void funcs.current.sync();
        },
        queue: async (m) => {
          await commit((s) => addMutation(s, m));
          void funcs.current.sync();
        },
        saveDraft: async (key, draft, valid) => {
          if (valid && !valid()) return;
          const capturedGeneration = state.bootstrap?.generation;
          if (capturedGeneration !== ref.current.bootstrap?.generation || ref.current.bootstrap?.active === false)
            throw Error("This draft belongs to an earlier Baby space.");
          await commit((s) => {
            if (valid && !valid()) return s;
            const drafts = { ...s.drafts };
            if (draft) drafts[key] = draft;
            else delete drafts[key];
            return queueRemovedUploads(s, { ...s, drafts });
          });
          if (!draft) void funcs.current.sync();
        },
        signOut,
        erase: async () => {
          const g = ref.current.bootstrap?.generation;
          if (g === undefined) return;
          deleting.current = true;
          setReady(false);
          let removed = false,
            cleaned = false;
          try {
            await revokeShareSession();
            await api.erase(g);
            removed = true;
            clearPendingShares();
            await clearReminders(ownerRef.current);
            await clearFiles(ownerRef.current);
            await commit(() => emptyState());
            cleaned = true;
          } catch (e) {
            if (removed)
              setError("Your Baby data was erased. Device cleanup needs another attempt. Choose Try again.");
            throw e;
          } finally {
            deleting.current = false;
            setReady(!removed || cleaned);
          }
          await funcs.current.refresh();
        },
        enroll: async () => {
          const g = ref.current.bootstrap?.generation;
          if (g === undefined) return;
          await api.enroll(g);
          await funcs.current.refresh();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

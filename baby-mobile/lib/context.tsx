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
import { ApiError, MovedError, createBabyApi, type BabyApi } from "./api";
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
  visitWriteProblem,
  visitLinkMessage,
  holdEditor,
  withoutHeldDraft,
  draftsBeforeFamily,
  fencedState,
  localFileUris,
  retiredSpaces,
  rejoined,
  retargeted,
  retryUnavailable,
  upgradedState,
  withKnownSpaces,
  withoutFamily,
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
  withPendingTracking,
  withoutTracking,
  trackingStep,
  withSettled,
  withoutBirth,
  withoutChain,
} from "./outbox";
import { revokeShareSession } from "./share-session-state";
import { clearPendingShares } from "../modules/hafa-baby-share/src";
import { clearFiles, removeLocal, uploadFile } from "./files";
import { clearReminders, reconcileCopies, reconcileReminders, scheduledNotifications } from "./reminders";
import { heldRoutines } from "./routine-report";
import { applyChanges, changePagesPerPass, removedFrom } from "./changes";
import { forgetInvite } from "./family";
import { nativePushDevice } from "./push-native";
import { refreshDue, refreshUpcoming, sendDismissals } from "./reminder-due";
import { wantedCopies } from "./reminder-copies";
import { accessKey, remindersOn, stampedDraft, fenceOf, familySpaces, generationOf, goneBabyMessage, rowFence, spacesLive, stuckTapMessage } from "./spaces";
const familyWork = (state: DeviceState, space?: string) => familySpaces(state.bootstrap).some((known) => known.id === space);
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
  /** Moves on when another phone's changes arrive, so a screen showing what the API worked out reads again. */
  changeTick: number;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
  commit: (change: (s: DeviceState) => DeviceState) => Promise<void>;
  queue: (m: Mutation) => Promise<void>;
  /** Takes later queued changes to the same record with it. `server` is the record as read just now: null if it's gone. `child` is the same for a birth change. */
  discardQueued: (id: string, server?: BabyRecord | null, child?: Child) => Promise<void>;
  discardHeld: (id: string) => Promise<void>;
  saveDraft: (key: string, draft: EditorDraft | null, valid?: () => boolean) => Promise<void>;
  getToken: () => Promise<string | null>;
  current: () => boolean;
  signOut: () => Promise<void>;
  erase: () => Promise<void>;
  enroll: () => Promise<void>;
  /** After she's allowed notifications: this phone goes on the list now, not on the next pass. */
  registerPush: () => Promise<boolean>;
  refreshPrefs: () => Promise<void>;
}
const Context = createContext<BabyContext | null>(null);
export function useBaby() {
  const context = useContext(Context);
  if (!context) throw Error("Baby account unavailable");
  return context;
}
/** For the few screens also reachable signed out, where no account exists. */
export function useBabyIfSignedIn() {
  return useContext(Context);
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
  const api = useMemo(() => createBabyApi(configuration.apiBase, () => token.current(), current, fetch, () => ref.current.bootstrap), [binding]);
  const identityVault = useMemo(() => createVault(secret, "identity:" + binding, Crypto.randomUUID), [binding]);
  const pushDevice = useMemo(() => nativePushDevice(api, secret, binding, () => onlineRef.current, Crypto.randomUUID), [binding]);
  const [owner, setOwner] = useState(""),
    [state, setState] = useState<DeviceState>(emptyState),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [syncing, setSyncing] = useState(false),
    [online, setOnline] = useState(true),
    [unreachable, setUnreachable] = useState(false),
    [changeTick, setChangeTick] = useState(0);
  const ref = useRef(state),
    vault = useRef<ReturnType<typeof createDeviceVault> | null>(null),
    serialized = useRef<Promise<unknown>>(Promise.resolve()),
    busy = useRef(false),
    pushRegistered = useRef(false),
    reporting = useRef(false),
    reportAgain = useRef(false),
    lastReport = useRef(""),
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
        const value = withPendingTracking(withPendingBirths(trackRoutineIntents(before, change(before), ownerRef.current)));
        if (deleting.current && value.bootstrap) throw Error("Baby data deletion is in progress.");
        // A space this account has left answers nothing here: its work waits to be kept or discarded.
        if (value.outbox.some((m) => { const known = generationOf(value.bootstrap, m.space_id); return known !== undefined && m.generation !== known && !(m.space_id && !spacesLive(value.bootstrap)); }) || (!value.bootstrap && value.outbox.length))
          throw Error("Older changes cannot be saved after Baby data is cleared.");
        // A family's own work can wait here while the personal space is started again.
        if (value.bootstrap?.active === false && (value.outbox.some((m) => !familyWork(value, m.space_id)) || Object.values(value.drafts).some((draft) => !familyWork(value, draft.space_id)) || Object.keys(value.childDrafts ?? {}).length))
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
    const staying = fencedState(ref.current, bootstrap);
    if (bootstrap.active === false || staying !== ref.current) {
      setReady(false);
      // Only what's retiring goes. With a family this account is still in, captures and its files can still go there.
      if (!familySpaces(bootstrap).length) clearPendingShares();
      await clearReminders(ownerRef.current);
      await clearFiles(ownerRef.current, () => localFileUris(fencedState(ref.current, bootstrap)), () => {
        const keep = localFileUris(fencedState(ref.current, bootstrap));
        return new Set([...localFileUris(ref.current)].filter((uri) => !keep.has(uri)));
      });
    }
    await commit((s) => {
      const fenced = fencedState(s, bootstrap),
        grew = familySpaces(bootstrap).some((space) => !familySpaces(s.bootstrap).some((known) => known.id === space.id)),
        // With no spaces listed the API has stopped saying, which isn't the same as this account being out of one.
        left = retiredSpaces(fenced, bootstrap).reduce((rows, space) => withoutFamily(rows, space, Crypto.randomUUID), fenced),
        next = withKnownSpaces(grew ? draftsBeforeFamily(retryUnavailable(rejoined(left, bootstrap)), bootstrap) : left, bootstrap),
        familyBaby = bootstrap.children.find((child) => familySpaces(bootstrap).some((space) => space.id === child.space_id));
      return upgradedState({
        ...next,
        bootstrap,
        selectedChild: grew && familyBaby && !familySpaces(bootstrap).some((space) => space.id === bootstrap.children.find((child) => child.id === next.selectedChild)?.space_id)
          // Joining: what she logs next is for the family's baby. Her own stays, and queued work and drafts keep their destinations.
          ? familyBaby.id
          : bootstrap.children.some((child) => child.id === next.selectedChild) ? next.selectedChild : null,
      });
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
          const upgraded = upgradedState(saved);
          ref.current = upgraded;
          setState(upgraded);
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
      const lease = api.lease(), access = accessKey(fresh);
      const page = await api.records({ limit: 100 });
      const recent = page.items.filter((r) => r.kind !== "routine");
      await commit(
        // A read from before she lost access can't put rows back.
        (s) => (accessKey(s.bootstrap) !== access ? s : {
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
  /**
   * Tells the API which routines this phone fires for itself, so it pushes only the ones it doesn't. Nothing is cancelled
   * here or anywhere else for this, so a phone that can't report, or reports late, carries on exactly as it was.
   */
  async function reportRoutines() {
    if (reporting.current) { reportAgain.current = true; return; }
    const owner = ownerRef.current;
    if (!pushRegistered.current || !owner || !ref.current.bootstrap?.reminders?.routines || ref.current.bootstrap.active === false || closing.current) return;
    reporting.current = true;
    try {
      const generation = ref.current.bootstrap.generation,
        holds = heldRoutines(await scheduledNotifications(owner), owner, generation, ref.current),
        said = JSON.stringify(Object.entries(holds).sort());
      if (said === lastReport.current) return;
      await api.reportRoutines(await pushDevice.installation(), holds);
      lastReport.current = said;
    } catch (failure) {
      // Dropped on the API's side, say by a token Apple retired. The next pass registers it again.
      if (failure instanceof ApiError && !failure.local && failure.status === 404) {
        pushRegistered.current = false;
        lastReport.current = "";
        pushDevice.forget();
      }
    } finally {
      reporting.current = false;
      if (reportAgain.current) { reportAgain.current = false; void reportRoutines(); }
    }
  }
  async function refreshPrefs() {
    if (!remindersOn(ref.current.bootstrap)) return;
    const lease = api.lease();
    try {
      const saved = await api.pushPrefs();
      await commit((s) => ({ ...s, reminderPrefs: saved }), lease);
    } catch { /* Quiet: with the flag off or no signal, the switches stay where they were. */ }
  }
  /** What other phones did. A failure is quiet: everything here stays as it is and the next pass asks from the same place. */
  async function pullChanges() {
    const lease = api.lease();
    try {
      for (let page = 0; page < changePagesPerPass; page++) {
        // A long first snapshot doesn't carry on once she's left, or under another account.
        if (!current() || closing.current || deleting.current || AppState.currentState === "background") return;
        const held = ref.current.changes, answer = await api.changes(held?.cursor ?? {}, held?.access ?? {});
        let result: ReturnType<typeof applyChanges> | undefined;
        await commit((s) => { result = applyChanges(s, answer, Crypto.randomUUID); return result.state; }, lease);
        if (result?.changed && current()) setChangeTick((tick) => tick + 1);
        // An answer that says there's more without moving on would only ask the same thing forever.
        if (!result?.more || JSON.stringify(result.state.changes) === JSON.stringify(held)) return;
      }
      rerun.current = true;
    } catch { /* The next pass carries on from the saved cursor. */ }
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
      if (latest.reminders?.push) {
        void pushDevice.ensure(latest.generation).then((registered) => {
          pushRegistered.current = registered;
          if (registered) void reportRoutines();
        });
        // Once, to know where the switches are. The screen itself asks again each time it's opened.
        if (!ref.current.reminderPrefs) void refreshPrefs();
      }
      restoreAfterSync = true;
      let serverChildren = latest.children;
      for (const pending of [...ref.current.outbox]) {
        const next = ref.current.outbox.find((m) => m.id === pending.id);
        if (!next) continue;
        if (!alive.current || !onlineRef.current) break;
        if (next.generation !== generationOf(latest, next.space_id) || next.conflict || next.error || next.localOnly) continue;
        if (next.type === "import" && next.automatic &&
          (!(latest.profile.ai_consent && latest.profile.auto_process_shares) ||
            (next.automatic_epoch ?? 0) !== (latest.profile.auto_process_epoch ?? 0))) {
          // The preceding original-save mutation remains. A later opt-in must
          // not resurrect an automatic provider request that was withdrawn.
          await commit((s) => ({ ...s, outbox: s.outbox.filter((m) => m.id !== next.id) }));
          continue;
        }
        if (heldUntil(next) || waitingForEarlier(ref.current.outbox, next) || waitingForImport(ref.current.imports, next)) continue;
        if (visitWriteProblem(ref.current, next)) {
          await commit((s) => ({ ...s, outbox: s.outbox.map((m) => m.id === next.id ? { ...m, error: visitLinkMessage, conflict: false } : m) }));
          continue;
        }
        try {
          let result: BabyRecord | undefined;
          if (next.type === "event_split") {
            let done: Awaited<ReturnType<typeof api.splitEvent>>;
            try {
              done = await api.splitEvent(next.series.id, { revision: next.series.revision ?? 0, from_start: next.from_start, event: next.event }, fenceOf(next));
            } catch (failure) {
              if (!(failure instanceof ApiError) || failure instanceof MovedError || failure.local || !current() || (failure.status !== 409 && failure.status !== 410)) throw failure;
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
            await api.remove(next.record, fenceOf(next));
          } else if (next.type === "child_birth") {
            const server = serverChildren.find((child) => child.id === next.child_id), step = birthStep(server, next);
            if (step === "gone" || step === "different") {
              await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id !== next.id ? m : { ...m,
                error: step === "gone" ? goneBabyMessage : "Another phone saved a different birth date. Discard this to keep that one." })) }));
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
                saved = await api.child({ id: server!.id, birth_date: next.birth_date, revision: server!.revision }, rowFence(server!, next.generation));
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
          } else if (next.type === "reminder_prefs") {
            // With the flag off there's nothing to send it to. It waits on this phone, and goes if the flag comes back.
            if (!latest.reminders?.push) continue;
            let taken = false;
            await commit((s) => {
              taken = s.outbox.some((m) => m.id === next.id);
              return { ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type === "reminder_prefs" ? { ...m, sent: true } : m)) };
            });
            if (!taken) continue;
            const saved = await api.savePushPrefs(next.patch, fenceOf(next));
            await commit((s) => ({ ...s, reminderPrefs: saved, outbox: s.outbox.filter((m) => m.id !== next.id) }));
            continue;
          } else if (next.type === "child_tracking") {
            const server = serverChildren.find((child) => child.id === next.child_id), step = trackingStep(server, next);
            if (step === "gone") {
              await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id === next.id ? { ...m, error: goneBabyMessage } : m)) }));
              continue;
            }
            let taken = false;
            await commit((s) => {
              taken = s.outbox.some((m) => m.id === next.id);
              return { ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type === "child_tracking" ? { ...m, sent: true } : m)) };
            });
            if (!taken) continue;
            let saved = server!;
            if (step === "send") {
              try {
                saved = await api.child({ id: server!.id, details: { tracking: next.tracking }, revision: server!.revision }, rowFence(server!, next.generation));
              } catch (failure) {
                if (!(failure instanceof ApiError && !failure.local && failure.status === 409) || !current()) throw failure;
                // Something else on this child moved. The next pass reads it again and sends the switch at its new revision.
                await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type === "child_tracking" ? retryLater(m) : m)) }));
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
                ? await api.feedAction(next.record_id, next.action, fenceOf(next))
                : await api.sessionAction(next.record_id, next.action, fenceOf(next));
            } catch (failure) {
              if (failure instanceof MovedError || !(failure instanceof ApiError && !failure.local && (failure.status === 404 || failure.status === 409)) || !current()) throw failure;
              let row: BabyRecord | null = null;
              try { row = await api.record(next.record_id); }
              catch (reading) {
                if (!(reading instanceof ApiError && !reading.local && reading.status === 404)) throw reading;
              }
              let outcome = rejectedAction(row, next.action);
              if (outcome === "removed" && spacesLive(latest)) {
                // Not readable isn't the same as gone, and nor is not being on this phone. The tap only goes once the API has said this row was removed.
                await pullChanges();
                // That pull may have ended her time in the family, which holds this as Not sent. It's hers to decide about.
                const held = ref.current.outbox.find((m) => m.id === next.id);
                if (!held || held.left_space) continue;
                if (!removedFrom(ref.current, next.space_id ?? ref.current.bootstrap?.personal_space_id, next.record_id)) outcome = "unresolved";
              }
              if (outcome === "unresolved") {
                // The feed still takes taps, so this was a passing race. It's kept, and asks her if it doesn't clear.
                const tries = (next.attempts ?? 0) + 1;
                await commit((s) => ({ ...s, records: row ? replaceRecord(s.records, row) : s.records,
                  outbox: s.outbox.map((m) => m.id !== next.id || (m.type !== "feed_action" && m.type !== "session_action") ? m
                    : tries >= unresolvedAttempts ? { ...m, error: stuckTapMessage } : retryLater(m)) }));
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
              const uploaded = await uploadFile(api, file, fenceOf(next));
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
              result = await api.save(feedEdit(value), fenceOf(next));
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
                fenceOf(next)
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
          if (e instanceof MovedError) {
            // The same change, to where its row lives now. It goes again straight after this pass.
            await commit((s) => { const held = s.outbox.find((m) => m.id === next.id); return held ? retargeted(s, held, e.moved, Crypto.randomUUID) : s; });
            rerun.current = true;
            continue;
          }
          const status = e instanceof ApiError ? e.status : -1;
          // A replayed save whose entry was removed elsewhere. It would refuse every pass, and hold everything behind it. With a file, the upload may be what expired.
          if (status === 410 && next.type === "save" && !next.files.length) {
            await commit((s) => ({ ...s, outbox: s.outbox.filter((m) => m.id !== next.id), records: s.records.filter((r) => r.id !== next.record.id) }));
            continue;
          }
          if (status === 410) {
            await refresh();
            break;
          }
          if (status === 0 || status === 401) {
            noteFailure(e);
            break;
          }
          // The flag went off just now. The API refused it, so it can still take later changes and go when the flag's back.
          if (status === 404 && next.type === "reminder_prefs") {
            await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type === "reminder_prefs" ? { ...retryLater(m), sent: false } : m)) }));
            continue;
          }
          if ((next.type === "reminder_prefs" || next.type === "feed_action" || next.type === "session_action" || next.type === "child_birth" || next.type === "child_tracking" || next.type === "event_split" || next.type === "delete" || retriedSave(next)) && shouldRetry(status)) {
            await commit((s) => ({ ...s, outbox: s.outbox.map((m) => (m.id === next.id && m.type !== "import" ? retryLater(m) : m)) }));
            continue;
          }
          await commit((s) => ({
            ...s,
            outbox: s.outbox.map((m) =>
              m.id === next.id ? { ...m, error: e instanceof ApiError && e.reason === "related_space" && next.type === "save" && ["journal", "question"].includes(next.record.kind) && next.record.data.event_id ? visitLinkMessage : messageFor(e), conflict: status === 409 } : m
            ),
          }));
        }
      }
      // Before the releases: one that keeps failing mustn't stop the other phone's changes arriving.
      if (spacesLive(latest)) await pullChanges();
      if (latest.reminders?.push) {
        await sendDismissals(api, commit, () => ref.current);
        await refreshDue(api, commit);
        await refreshUpcoming(api, commit);
      } else if (ref.current.upcomingReminders) {
        // The flag went off: what its copies were for isn't coming.
        await reconcileCopies(ownerRef.current, []);
        await commit((s) => { const { upcomingReminders: _, dueReminders: __, ...rest } = s; return rest; });
      }
      for (const id of ref.current.fileReleases ?? []) {
        if (uploadedReferences(ref.current).has(id)) continue;
        try {
          await api.releaseAttachment(id, latest.generation);
        } catch (failure) {
          // It moved with its record, or was retired when someone left. Either way there's nothing here to release.
          if (!(failure instanceof ApiError && !failure.local && (failure.status === 404 || failure instanceof MovedError))) throw failure;
        }
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
          await pushDevice.end();
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
          const upgraded = upgradedState(saved);
          ref.current = upgraded;
          setState(upgraded);
        }
        setReady(true);
        await openingAccount(() => funcs.current.refresh(true), () => !cancelled && current());
        await funcs.current.sync();
      } catch (e) {
        if (!cancelled) noteFailure(e);
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
      }).then(() => { if (!cancelled) void reportRoutines(); }, () => {
        if (!cancelled && current())
          setError(
            "Your entries are saved, but reminders need another attempt. Open Routines or check notification settings."
          );
      });
    return () => {
      cancelled = true;
    };
  }, [state, owner, ready]);
  const offlineNow = !online || (unreachable && !!error);
  useEffect(() => {
    // Off, with nothing kept, is a phone that has never heard of any of this: it doesn't even look.
    if (!ready || !owner || closing.current || (!remindersOn(state.bootstrap) && !state.upcomingReminders)) return;
    void reconcileCopies(owner, remindersOn(state.bootstrap) && state.bootstrap?.active !== false ? wantedCopies(state, offlineNow, new Date()) : []);
  }, [state.upcomingReminders, state.outbox, state.dismissing, state.reminderPrefs, state.bootstrap?.spaces, state.bootstrap?.reminders?.push, offlineNow, owner, ready]);
  async function clean() {
    // First, while it can still reach the API as this person.
    await pushDevice.end();
    pushRegistered.current = false;
    lastReport.current = "";
    forgetInvite();
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
        changeTick,
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
            return removed.type === "child_birth" ? withoutBirth(left, removed, child) : removed.type === "child_tracking" ? withoutTracking(left, removed, child) : left;
          });
          void funcs.current.sync();
        },
        discardHeld: async (id) => {
          let removed: string[] = [];
          await commit((s) => {
            if (busy.current) throw Error("Wait for the current sync to finish before discarding a draft.");
            const next = withoutHeldDraft(s, id), staying = localFileUris(next);
            removed = [...localFileUris(s)].filter((uri) => !staying.has(uri));
            return next;
          });
          for (const uri of removed) if (!localFileUris(ref.current).has(uri)) await removeLocal(ownerRef.current, uri);
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
            if (draft) {
              const placed = stampedDraft(s, s.drafts[key], draft);
              if (placed.space_id && spacesLive(s.bootstrap) && !s.bootstrap!.spaces!.some((space) => space.id === placed.space_id))
                return queueRemovedUploads(s, holdEditor(s, key, placed, Crypto.randomUUID));
              drafts[key] = placed;
            }
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
        refreshPrefs,
        registerPush: async () => {
          const held = ref.current.bootstrap;
          return held?.reminders?.push && held.active !== false && !closing.current ? pushDevice.ensure(held.generation) : false;
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

import { ActivityIndicator } from "react-native";
import { Screen, Notice, Button, Copy } from "@/components/ui";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { useAuth, useClerk } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AppState } from "react-native";
import { createWorkoutsApi, type WorkoutsApi } from "./api";
import { configuration } from "./config";
import { privateRegistry, erasePrivateDeviceData } from "./private-device";
import { drafts } from "./drafts";
import { commitTrainingSetup, activeTrainingGeneration } from "./onboarding-state";
import { createEnrollmentBootstrap, createVerifiedIdentityCache, type BootstrapState, type EnrollmentSetupLease } from "./enrollment-bootstrap";
import type { Enrollment, TrainingProfile } from "./models";
import { createTrainingStore, type TrainingStore, type UnitSystem } from "./training";
interface ContextValue {
  api: WorkoutsApi;
  storage: ReturnType<typeof privateRegistry.capture>;
  localDrafts: ReturnType<typeof drafts>;
  eraseLocalData(): Promise<void>;
  invalidateAccount(): void;
  isCurrentAccount(): boolean;
  beginSetup(expectedGeneration: number | null): EnrollmentSetupLease;
  completeSetup(
    member: Enrollment,
    profile: TrainingProfile | undefined,
    expectedGeneration: number | null,
    draftScope: string
  ): Promise<void>;
  owner: string;
  enrollment: Enrollment | null;
  enrollmentQuery: UseQueryResult<Enrollment, Error>;
  units: UnitSystem;
  setUnits(value: UnitSystem): Promise<void>;
}
const Context = createContext<ContextValue | null>(null);
const OfflineContext = createContext<{ store: TrainingStore | null; ready: boolean; error: string; retry(): void }>({
  store: null,
  ready: false,
  error: "",
  retry() {},
});
const identityStorage = createVerifiedIdentityCache(AsyncStorage);
function accountAccessMessage(error: Error | null) {
  const status = (error as { status?: number } | null)?.status;
  if (status === 403) return "This account does not have access to the Workouts private beta. Choose an invited account or ask for access.";
  if (status === 401) return "Your sign-in session expired. Sign out and sign in again to open your training.";
  return error?.message;
}
function OfflineProvider({
  owner,
  generation,
  storage,
  children,
}: PropsWithChildren<{
  owner: string;
  generation: number | null;
  storage: ReturnType<typeof privateRegistry.capture>;
}>) {
  const store = useMemo(
    () => (generation == null ? null : createTrainingStore(storage, owner, generation)),
    [owner, generation, storage]
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    if (store)
      void store
        .load()
        .then(() => {
          if (active) setReady(true);
        })
        .catch(() => {
          if (active)
            setError(
              "Could not restore your training on this device. It has not been overwritten. Try again or contact support."
            );
        });
    return () => {
      active = false;
    };
  }, [store, attempt]);
  return (
    <OfflineContext.Provider value={{ store, ready, error, retry: () => setAttempt((x) => x + 1) }}>
      {children}
    </OfflineContext.Provider>
  );
}
export function TrainingProvider({ children }: PropsWithChildren) {
  const { getToken, userId, sessionId } = useAuth();
  const clerk = useClerk();
  // Clerk may return a new function on each render. Keep owner-bound API state
  // stable while requests still retrieve the latest token; API binding guards
  // continue checking the account before and after that asynchronous retrieval.
  const tokenGetter = useRef(getToken);
  tokenGetter.current = getToken;
  const currentToken = useCallback(() => tokenGetter.current(), []);
  const subject = userId ?? "";
  const binding = `${configuration.clerkEnvironment}:${configuration.clerkKey}:${subject}`;
  const currentAuth = useRef({ binding, sessionId });
  currentAuth.current = { binding, sessionId };
  const signingOut = useRef<{ binding: string; sessionId: string } | null>(null);
  const [recovery, setRecovery] = useState({ binding, sessionId, busy: false, error: "" });
  const recoveryBusy = recovery.binding === binding && recovery.sessionId === sessionId && recovery.busy;
  const recoveryError = recovery.binding === binding && recovery.sessionId === sessionId ? recovery.error : "";
  const invalidBindings = useRef(new Set<string>());
  const bindingRef = useRef<string | null>(binding);
  bindingRef.current = invalidBindings.current.has(binding) ? null : binding;
  useEffect(() => {
    bindingRef.current = invalidBindings.current.has(binding) ? null : binding;
    return () => { bindingRef.current = null; };
  }, [binding]);
  const identityApi = useMemo(
    () =>
      createWorkoutsApi(configuration.apiBase, currentToken, fetch, { binding, currentBinding: () => bindingRef.current }),
    [binding, currentToken]
  );
  const identityQuery = useQuery({
    queryKey: ["identity", binding],
    queryFn: identityApi.identity,
    enabled: !!subject && !recoveryBusy,
    retry: 1,
  });
  const [cachedIdentity, setCachedIdentity] = useState<{ id: string; binding: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (subject)
      void identityStorage.load(binding).then((value) => {
        if (active && value?.binding === binding) setCachedIdentity(value);
      }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [binding, subject]);
  const blockedIdentity =
    (identityQuery.error as { status?: number } | null)?.status === 401 ||
    (identityQuery.error as { status?: number } | null)?.status === 403;
  const owner =
    blockedIdentity ? "" : identityQuery.data?.id ?? (cachedIdentity?.binding === binding ? cachedIdentity.id : "");
  const api = useMemo(() => {
    const selected = createWorkoutsApi(configuration.apiBase, currentToken, fetch, {
      owner: owner || undefined, binding, currentBinding: () => bindingRef.current,
    });
    return { ...selected, async deleteHafaAccount() {
      const result = await selected.deleteHafaAccount();
      if (bindingRef.current === binding) { invalidBindings.current.add(binding); bindingRef.current = null; }
      return result;
    } };
  }, [owner, binding, currentToken]);
  const scope = `${binding}:${owner}`;
  const [boot, setBoot] = useState<{ scope: string; value: BootstrapState } | null>(null);
  const [units, setUnitValue] = useState<UnitSystem>("imperial");
  const enrollmentQuery = useQuery({
    queryKey: [owner, "enrollment"],
    queryFn: ({ signal }) => api.enrollment({ signal }),
    retry: 1,
    enabled: !!owner && !recoveryBusy,
  });
  const enrollment = boot?.scope === scope ? boot.value.enrollment : null;
  const [localEpoch, setLocalEpoch] = useState(0);
  const [privateError, setPrivateError] = useState("");
  const storage = useMemo(() => privateRegistry.capture(owner), [owner, enrollment?.generation, localEpoch]);
  const localDrafts = useMemo(() => drafts(storage), [storage]);
  async function eraseLocalData() {
    await erasePrivateDeviceData(owner, binding);
    if (currentOwner.current !== owner || bindingRef.current !== binding) return;
    setPrivateError("");
    setBoot((old) => old?.scope === scope ? { ...old, value: { ...old.value, units: "imperial" } } : old);
    setUnitValue("imperial");
    setLocalEpoch((x) => x + 1);
  }
  function invalidateAccount() {
    invalidBindings.current.add(binding);
    bindingRef.current = null;
  }
  const cache = useQueryClient();
  const setupRef = useRef<EnrollmentSetupLease | null>(null);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  async function signOutForRecovery() {
    if (!sessionId || currentAuth.current.binding !== binding || currentAuth.current.sessionId !== sessionId ||
      (signingOut.current?.binding === binding && signingOut.current.sessionId === sessionId)) return;
    const captured = { binding, sessionId };
    signingOut.current = captured;
    setRecovery({ binding, sessionId, busy: true, error: "" });
    let signedOut = false;
    const scoped = (query: { queryKey: readonly unknown[] }) =>
      (!!owner && query.queryKey[0] === owner) ||
      (query.queryKey[0] === "identity" && query.queryKey[1] === binding);
    try {
      await cache.cancelQueries({ predicate: scoped });
      if (currentAuth.current.binding !== binding || currentAuth.current.sessionId !== sessionId) return;
      await clerk.signOut({ sessionId });
      signedOut = true;
      cache.removeQueries({ predicate: scoped });
    } catch {
      if (currentAuth.current.binding === binding && currentAuth.current.sessionId === sessionId)
        setRecovery({ binding, sessionId, busy: false, error: "Could not sign out. Your private drafts remain saved for this account. Try again." });
    } finally {
      if (!signedOut && signingOut.current === captured) signingOut.current = null;
      // The SDK may settle before its hooks publish. Keep private consumers closed until the captured session leaves.
      if (!signedOut && currentAuth.current.binding === binding && currentAuth.current.sessionId === sessionId)
        setRecovery((value) => ({ ...value, busy: false }));
    }
  }
  const bootstrap = useMemo(() => createEnrollmentBootstrap({
    owner,
    isCurrent: () => !!owner && currentOwner.current === owner && bindingRef.current === binding,
    async load() {
      const local = drafts(privateRegistry.capture(owner));
      const [member, preferred] = await Promise.all([local.load<Enrollment>(owner, "enrollment"), local.load<UnitSystem>(owner, "units")]);
      return { enrollment: member, units: preferred === "metric" ? "metric" as const : "imperial" as const };
    },
    clearQueries() { cache.removeQueries({ predicate: (q) => q.queryKey[0] === owner && q.queryKey[1] !== "enrollment" }); },
    async retire() { await erasePrivateDeviceData(owner, binding); if (currentOwner.current === owner && bindingRef.current === binding) setLocalEpoch((x) => x + 1); },
    fresh() { const captured = privateRegistry.capture(owner); return { drafts: drafts(captured), isCurrent: captured.isCurrent }; },
    async rememberIdentity() {
      const captured = privateRegistry.capture(owner);
      await identityStorage.save(binding, owner, () => captured.isCurrent() && currentOwner.current === owner && bindingRef.current === binding);
    },
    publishEnrollment(member) { api.commitEnrollment(member); cache.setQueryData([owner, "enrollment"], member); },
    publish(value) { setBoot({ scope, value }); if (value.status === "ready") setUnitValue(value.units); },
  }), [owner, binding, api, cache]);
  useEffect(() => {
    if (!owner) return;
    bootstrap.activate();
    void bootstrap.hydrate();
    return () => { setupRef.current = null; bootstrap.dispose(); };
  }, [bootstrap, owner]);
  useEffect(() => {
    if (!owner || enrollmentQuery.isPending) return;
    void bootstrap.server(enrollmentQuery.data ?? null, (enrollmentQuery.error as { status?: number } | null)?.status);
  }, [bootstrap, owner, enrollmentQuery.data, enrollmentQuery.isPending, enrollmentQuery.error]);
  useEffect(() => {
    const id = identityQuery.data?.id;
    if (!id || id !== owner) return;
    const captured = privateRegistry.capture(owner);
    void identityStorage.save(binding, owner, () => captured.isCurrent() && currentOwner.current === owner && bindingRef.current === binding).catch(() => undefined);
  }, [identityQuery.data, owner, binding]);
  function beginSetup(expectedGeneration: number | null) {
    const lease = bootstrap.beginSetup(expectedGeneration);
    setupRef.current = lease;
    return lease;
  }
  async function completeSetup(
    member: Enrollment,
    profile: TrainingProfile | undefined,
    expectedGeneration: number | null,
    draftScope: string
  ) {
    function guardOwner() {
      if (currentOwner.current !== owner || bindingRef.current !== binding)
        throw Error("The Håfa account changed. Training setup was stopped.");
    }
    const setup = setupRef.current;
    const setupScope = setup?.scope();
    const capturedStorage = storage;
    let retired = false;
    let selectedUnits = units;
    try {
      await commitTrainingSetup({
        owner,
        member,
        profile,
        expected_generation: expectedGeneration,
        units,
        draft_scope: draftScope,
        cache,
        drafts: setupScope?.drafts ?? localDrafts,
        guardOriginal() {
          guardOwner();
          if (setupScope) { setupScope.guard(); return; }
          if (!capturedStorage.isCurrent())
            throw Error("Your previous device state was retired. Refresh enrollment before saving again.");
        },
        guardOwner,
        cleanPrevious: async () => {
          retired = true;
          await erasePrivateDeviceData(owner, binding);
        },
        rememberUnits(value) {
          selectedUnits = value;
        },
        freshDrafts() {
          const fresh = privateRegistry.capture(owner);
          return { drafts: drafts(fresh), isCurrent: fresh.isCurrent };
        },
        rememberGeneration() {},
        sealEnrollment(member) { api.commitEnrollment(member); },
        ready(value, enrolled, replaced) {
          setUnitValue(value);
          setup?.complete(enrolled, value);
          setupRef.current = null;
          if (replaced) setLocalEpoch((x) => x + 1);
        },
      });
    } catch (error) {
      if (retired && currentOwner.current === owner && bindingRef.current === binding) {
        setUnitValue(selectedUnits);
        setLocalEpoch((value) => value + 1);
        throw Error(
          "Your account setup needs another device check. Reload your enrollment before retrying; old drafts stay retired."
        );
      }
      throw error;
    }
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && owner) void enrollmentQuery.refetch();
    });
    return () => sub.remove();
  }, [enrollmentQuery.refetch, owner]);
  async function setUnits(value: UnitSystem) {
    if (currentOwner.current !== owner || bindingRef.current !== binding) throw Error("The account changed. Refresh before changing units.");
    await localDrafts.save(owner, "units", value);
    if (currentOwner.current !== owner || bindingRef.current !== binding) throw Error("The account changed. Refresh before changing units.");
    bootstrap.units(value);
    setUnitValue(value);
  }
  useEffect(
    () => () => {
      if (owner) cache.removeQueries({ predicate: (q) => q.queryKey[0] === owner });
    },
    [owner, cache]
  );
  if (!userId) return null;
  const recoveryControls = <>
    {!!recoveryError && <Notice error>{recoveryError}</Notice>}
    <Button title="Sign out and choose account" secondary busy={recoveryBusy} disabled={!sessionId}
      onPress={() => { void signOutForRecovery(); }} />
    <Copy kind="small">Your private drafts stay saved on this device for this account.</Copy>
  </>;
  if (!owner)
    return (
      <Screen title="Open your Håfa account.">
        <Copy>Verifying your account identity…</Copy>
        {identityQuery.error && (
          <>
            <Notice error>{accountAccessMessage(identityQuery.error)}</Notice>
            <Button
              title="Try verifying again"
              disabled={recoveryBusy}
              onPress={() => {
                void identityQuery.refetch();
              }}
            />
            {recoveryControls}
          </>
        )}
      </Screen>
    );
  const live = enrollmentQuery.data;
  const changedAuthority = !!live && !!enrollment && (live.generation !== enrollment.generation || live.enrolled !== enrollment.enrolled);
  const awaitingOwnAcknowledgement = !!setupRef.current && !enrollment?.enrolled && !!live?.enrolled;
  const enrollmentDenied = [401, 403].includes((enrollmentQuery.error as { status?: number } | null)?.status ?? 0);
  if (recoveryBusy || enrollmentDenied || boot?.scope !== scope || boot.value.status === "pending" || boot.value.status === "blocked" || privateError || (changedAuthority && !awaitingOwnAcknowledgement))
    return <Screen title="Open your saved training.">
      <Copy>{enrollmentDenied ? accountAccessMessage(enrollmentQuery.error) : boot?.scope === scope && boot.value.status === "blocked" ? boot.value.error : "Checking your account and saved training…"}</Copy>
      {(enrollmentDenied || boot?.value.status === "blocked" || privateError || recoveryBusy) ? <>
        {!!privateError && <Notice error>{privateError}</Notice>}
        <Button title="Try checking again" disabled={recoveryBusy} onPress={() => {
          void identityQuery.refetch(); void enrollmentQuery.refetch(); void bootstrap.retry();
        }} />
        {recoveryControls}
      </> : <ActivityIndicator accessibilityLabel="Verifying private training" />}
    </Screen>;
  return (
    <Context.Provider
      value={{
        api,
        owner,
        enrollment,
        enrollmentQuery,
        units,
        setUnits,
        storage,
        localDrafts,
        eraseLocalData,
        invalidateAccount,
        isCurrentAccount: () => currentOwner.current === owner && bindingRef.current === binding,
        completeSetup,
        beginSetup,
      }}
    >
      <OfflineProvider
        key={`${owner}:${enrollment?.generation ?? "none"}:${!!enrollment?.enrolled}`}
        owner={owner}
        storage={storage}
        generation={activeTrainingGeneration(enrollment)}
      >
        {children}
      </OfflineProvider>
    </Context.Provider>
  );
}
export function useTraining() {
  const c = useContext(Context);
  if (!c) throw new Error("Training requires a signed-in account");
  return c;
}
const empty = { version: 1 as const, generation: 0, active: null, history: [] };
export function useOfflineTraining() {
  const c = useContext(OfflineContext);
  const state = useSyncExternalStore(
    c.store?.subscribe ?? (() => () => {}),
    c.store?.snapshot ?? (() => empty),
    () => empty
  );
  return { ...c, state };
}

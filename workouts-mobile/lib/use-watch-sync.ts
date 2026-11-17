import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTraining } from "./context";
import type { TrainingStore } from "./training";
import { dateInTimezone } from "./training";
import { drainWatch, planContext, watchAccountKey, stablePlans, pruneWatchCatalog, type WatchAttention, type WatchCatalog } from "./watch-sync";
import { nativeWatchBridge, watchPlansEpoch, watchSyncSuspended, resumeWatchSync, subscribeWatchResync, watchResyncToken, type WatchBridge } from "./watch-native";

export function useWatchSync(store: TrainingStore | null, ready: boolean) {
  const { api, owner, enrollment, units, localDrafts, isCurrentAccount, storage } = useTraining();
  const [watchBridge, setBridge] = useState<WatchBridge | null>(null);
  // Mounting means a signed-in account; an earlier account's sign-out suspension does not carry over.
  useEffect(() => { if (watchSyncSuspended()) resumeWatchSync(); }, []);
  useEffect(() => { let active = true; void nativeWatchBridge().then(b => { if (active) setBridge(b); }); return () => { active = false; }; }, []);
  const [attention, setAttention] = useState<{ account: string; items: WatchAttention[] }>({ account: "", items: [] });
  const lastPlans = useRef({ account: "", epoch: -1, fingerprint: "" });
  const resync = useSyncExternalStore(subscribeWatchResync, watchResyncToken, watchResyncToken);
  const refresh = useRef(() => {});
  const generation = enrollment?.generation;
  const enabled = !!watchBridge && !!generation && !!enrollment?.enrolled;
  const library = useQuery({ queryKey: [owner, "library", "search", generation], queryFn: api.library, enabled });
  const programs = useQuery({ queryKey: [owner, "programs", generation], queryFn: api.programs, enabled });
  const profile = useQuery({ queryKey: [owner, "profile", generation], queryFn: api.profile, enabled });
  useEffect(() => {
    if (!enabled || !watchBridge || !store || !ready || !generation) return;
    const bridge = watchBridge, account = watchAccountKey(owner, generation), epoch = watchPlansEpoch();
    if (lastPlans.current.account !== account || lastPlans.current.epoch !== epoch) lastPlans.current = { account, epoch, fingerprint: "" };
    let disposed = false, running = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void pass(); }, 300); };
    refresh.current = schedule;
    const current = () => !disposed && !watchSyncSuspended() && epoch === watchPlansEpoch() && AppState.currentState === "active" && isCurrentAccount() && storage.isCurrent();
    async function pass() {
      if (!current()) return;
      if (running) { again = true; return; }
      running = true;
      try {
        const prior = await localDrafts.load<WatchCatalog>(owner, `watch-catalog:${generation}`) ?? {};
        if (!current()) return;
        const pending = await bridge.pendingResults();
        const items = await drainWatch({ pendingResults: async () => pending, markImported: id => bridge.markImported(id),
          current, account, generation: generation!, catalog: prior, store: store! });
        if (current()) setAttention({ account, items });
        if (library.data && programs.data && profile.data && current()) {
          const context = planContext({ account, units, today: dateInTimezone(new Date(), profile.data.timezone),
            library: library.data, programs: programs.data, state: store!.snapshot(), leadIn: store!.getLeadIn() });
          // Pin snapshots durably before any plan leaves this phone.
          const catalog = pruneWatchCatalog(prior, context.catalog, pending);
          if (JSON.stringify(catalog) !== JSON.stringify(prior)) await localDrafts.save(owner, `watch-catalog:${generation}`, catalog);
          const fingerprint = stablePlans(context.json);
          if (current() && lastPlans.current.fingerprint !== fingerprint) {
            await bridge.setPlans(context.json);
            if (current()) lastPlans.current.fingerprint = fingerprint;
          }
        }
      } catch { /* Connectivity can be unavailable. Keep the native inbox and cached watch plans. */ }
      finally { running = false; if (again) { again = false; schedule(); } }
    }
    const results = bridge.addListener("onResults", schedule);
    const app = AppState.addEventListener("change", s => { if (s === "active") schedule(); });
    const unsubscribe = store.subscribe(schedule);
    schedule();
    return () => { disposed = true; clearTimeout(timer); refresh.current = () => {}; results.remove(); app.remove(); unsubscribe(); };
  }, [resync, watchBridge, enabled, store, ready, generation, owner, units, localDrafts, storage, api, library.data, programs.data, profile.data, isCurrentAccount]);
  const account = generation ? watchAccountKey(owner, generation) : "";
  return { attention: attention.account === account ? attention.items : [],
    async discard(id: string) {
      if (!attention.items.some(item => item.id === id && item.discardable) || attention.account !== account || !watchBridge || !isCurrentAccount() || !storage.isCurrent() || AppState.currentState !== "active") return;
      await watchBridge.markImported(id); refresh.current();
    } };
}

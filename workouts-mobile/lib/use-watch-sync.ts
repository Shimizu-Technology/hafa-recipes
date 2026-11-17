import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTraining } from "./context";
import type { TrainingStore } from "./training";
import { dateInTimezone } from "./training";
import { drainWatch, planContext, watchAccountKey } from "./watch-sync";
import { nativeWatchBridge, type WatchBridge } from "./watch-native";

export function useWatchSync(store: TrainingStore | null, ready: boolean) {
  const { api, owner, enrollment, units, localDrafts, isCurrentAccount, storage } = useTraining();
  const [watchBridge, setBridge] = useState<WatchBridge | null>(null);
  useEffect(() => { let active = true; void nativeWatchBridge().then(b => { if (active) setBridge(b); }); return () => { active = false; }; }, []);
  const generation = enrollment?.generation;
  const enabled = !!watchBridge && !!generation && !!enrollment?.enrolled;
  const library = useQuery({ queryKey: [owner, "library", "search", generation], queryFn: api.library, enabled });
  const programs = useQuery({ queryKey: [owner, "programs", generation], queryFn: api.programs, enabled });
  const profile = useQuery({ queryKey: [owner, "profile", generation], queryFn: api.profile, enabled });
  useEffect(() => {
    if (!enabled || !watchBridge || !store || !ready || !generation) return;
    const bridge = watchBridge, account = watchAccountKey(owner, generation);
    let disposed = false, running = false, again = false;
    const current = () => !disposed && AppState.currentState === "active" && isCurrentAccount() && storage.isCurrent();
    async function pass() {
      if (!current()) return;
      if (running) { again = true; return; }
      running = true;
      try {
        const prior = await localDrafts.load<Record<string, import("./models").Workout>>(owner, `watch-catalog:${generation}`) ?? {};
        if (!current()) return;
        await drainWatch({ pendingResults: () => bridge.pendingResults(), markImported: id => bridge.markImported(id),
          current, account, generation: generation!, catalog: prior, store: store! });
        if (library.data && programs.data && profile.data && current()) {
          const context = planContext({ account, units, today: dateInTimezone(new Date(), profile.data.timezone),
            library: library.data, programs: programs.data, state: store!.snapshot(), leadIn: store!.getLeadIn() });
          // Pin snapshots durably before any plan leaves this phone.
          await localDrafts.save(owner, `watch-catalog:${generation}`, { ...prior, ...context.catalog });
          if (current()) await bridge.setPlans(context.json);
        }
      } catch { /* Connectivity can be unavailable. Keep the native inbox and cached watch plans. */ }
      finally { running = false; if (again) { again = false; queueMicrotask(() => { void pass(); }); } }
    }
    const results = bridge.addListener("onResults", () => { void pass(); });
    const app = AppState.addEventListener("change", s => { if (s === "active") void pass(); });
    const unsubscribe = store.subscribe(() => { void pass(); });
    void pass();
    return () => { disposed = true; results.remove(); app.remove(); unsubscribe(); };
  }, [watchBridge, enabled, store, ready, generation, owner, units, localDrafts, storage, api, library.data, programs.data, profile.data, isCurrentAccount]);
}

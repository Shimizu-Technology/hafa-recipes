import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useTraining } from "./context";
import { configuration } from "./config";
import { savePrivateExport } from "./export-file";
import { createExportController, terminalExport, type ExportJobView } from "./export-jobs";

export function useExportJob(binding: string) {
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const current = useRef({ enrollment, storage, isCurrentAccount, binding, owner });
  current.current = { enrollment, storage, isCurrentAccount, binding, owner };
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [pollStopped, setPollStopped] = useState(false);
  const [controller, setController] = useState<ReturnType<typeof createExportController> | null>(null);
  const controllerScope = useRef<{ owner: string; generation: number; binding: string; storage: typeof storage; api: typeof api } | null>(null);
  const [view, setView] = useState<ExportJobView>({ phase: "loading", command: null, job: null, busy: false, error: "", message: "", pages: 0, invalidated: false });
  useFocusEffect(useCallback(() => { setFocused(true); return () => { setFocused(false); }; }, []));
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => listener.remove();
  }, []);
  const enabled = focused && active && !!enrollment?.enrolled;
  const visibility = useRef({ active, focused });
  visibility.current = { active, focused };
  const capability = useQuery({
    queryKey: [owner, "export-capabilities", generation],
    queryFn: () => api.capabilities(),
    enabled,
    staleTime: 30000,
    retry: false,
  });
  useEffect(() => {
    const created = createExportController({
      scope: { owner, generation, binding, backend: configuration.apiBase },
      storage, api, newRequestId: randomUUID, save: savePrivateExport,
      isCurrent: () => current.current.binding === binding && current.current.owner === owner &&
        current.current.isCurrentAccount() && storage.isCurrent() && !!current.current.enrollment?.enrolled &&
        current.current.enrollment.generation === generation,
    });
    controllerScope.current = { owner, generation, binding, storage, api };
    setView(created.state()); setController(created);
    const unsubscribe = created.subscribe(setView);
    return () => { unsubscribe(); created.dispose(); controllerScope.current = null; };
  }, [owner, generation, binding, storage, api]);
  useEffect(() => {
    const pause = () => controller?.pause(!visibility.current.active && visibility.current.focused ? "background" : "focus");
    if (!controller || !enabled) { pause(); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    let lastRequest: string | null | undefined;
    let stopAt = Date.now() + 120000;
    setPollStopped(false);
    const tick = async (first = false) => {
      if (cancelled) return;
      if (first) await controller.restore();
      else {
        const state = controller.state();
        // A disposed screen may still be settling its aborted operation. Retry the read-only restore,
        // within this same bounded foreground window, once the per-scope mutation mutex is free.
        if (state.phase === "loading") {
          if (checks < 30 && Date.now() < stopAt) { ++checks; await controller.restore(); }
          else setPollStopped(true);
          if (!cancelled) timer = setTimeout(() => { void tick(); }, 4000);
          return;
        }
        const request = state.command?.request_id ?? null;
        if (request !== lastRequest) {
          if (lastRequest !== undefined && request !== null) { checks = 0; stopAt = Date.now() + 120000; }
          lastRequest = request; setPollStopped(false);
        }
        const pending = state.command && !state.invalidated &&
          !(state.job && terminalExport(state.job) && !state.job.cleanup_pending) &&
          !(state.job?.status === "ready" && !state.command.cancel_requested);
        if (pending && checks < 30 && Date.now() < stopAt) { ++checks; await controller.check(); }
        else if (pending && Date.now() >= stopAt) setPollStopped(true);
      }
      if (cancelled) return;
      if (checks >= 30) setPollStopped(true);
      timer = setTimeout(() => { void tick(); }, 4000);
    };
    void tick(true);
    return () => { cancelled = true; clearTimeout(timer); pause(); };
  }, [controller, enabled]);
  // Never select the old path merely because a job admission or status request failed.
  const captured = controllerScope.current;
  const sameScope = captured?.owner === owner && captured.generation === generation && captured.binding === binding &&
    captured.storage === storage && captured.api === api;
  // Hide the previous account's status/counts in the render preceding the new effect, as well as fencing callbacks.
  const visible: ExportJobView = sameScope ? view : { phase: "loading", command: null, job: null, busy: false, error: "", message: "", pages: 0, invalidated: false };
  const useJobs = !!visible.command || capability.data?.export_jobs === true;
  const knownLegacy = capability.isSuccess && capability.data.export_jobs !== true && visible.phase !== "loading" && !visible.command && !visible.error;
  return { controller: sameScope ? controller : null, view: visible, enabled, useJobs, knownLegacy, pollStopped, capability,
    check: () => { if (sameScope) void controller?.check(); },
  };
}

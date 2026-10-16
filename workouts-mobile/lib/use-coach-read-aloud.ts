import { useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import * as Speech from "expo-speech";
import { createCoachReadAloud } from "./coach-read-aloud";
import type { CoachMessage } from "./coach";

const device = createCoachReadAloud({ ...Speech,
  // The SDK waits indefinitely for voiceschanged when a browser has no voices.
  // Inspect the current browser list instead; unavailable voices remain retryable.
  getAvailableVoicesAsync: Platform.OS !== "web" ? Speech.getAvailableVoicesAsync : async () =>
    (globalThis.speechSynthesis?.getVoices() ?? []).map(voice => ({ identifier: voice.voiceURI,
      language: voice.lang, localService: voice.localService })),
}, Platform.OS === "web");
/** Await before starting microphone capture; speech must not dictate into the draft. */
export const stopCoachReadAloud = () => device.stop();
export function useCoachReadAloud(input: {
  owner: string; generation: number; storage: { isCurrent(): boolean }; focus: string; epoch: string;
  enabled: boolean; isCurrentAccount(): boolean;
}) {
  const scope = useMemo(() => ({}), [input.owner, input.generation, input.storage, input.focus, input.epoch, input.enabled]);
  const active = useRef<object | null>(null);
  const [activation, setActivation] = useState<object | null>(null);
  useFocusEffect(useCallback(() => {
    const token = {}; active.current = token; setActivation(token);
    return () => { if (active.current === token) active.current = null; void device.stop(scope).catch(() => undefined); };
  }, [scope]));
  const committed = useRef<{ scope: object; input: typeof input; valid: boolean } | null>(null);
  useLayoutEffect(() => {
    const previous = committed.current;
    const valid = input.enabled && !!input.owner && input.generation > 0 && input.storage.isCurrent() && input.isCurrentAccount() && AppState.currentState === "active";
    committed.current = { scope, input, valid };
    // Authority may retire inside the same storage/account object. Stop once on
    // its committed transition; a rejected Stop remains an explicit retry.
    if (previous?.scope === scope && previous.valid && !valid) void device.stop(scope).catch(() => undefined);
  });
  useLayoutEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state !== "active") void device.stop(scope).catch(() => undefined); });
    return () => {
      if (committed.current?.scope === scope) committed.current = null;
      void device.stop(scope).catch(() => undefined);
      sub.remove();
    };
  }, [scope]);
  const stop = useCallback(() => device.stop(scope), [scope]);
  const state = useSyncExternalStore(device.subscribe, device.snapshot, device.snapshot);
  const current = () => {
    const selected = committed.current;
    return !!activation && active.current === activation && selected?.scope === scope && selected.valid && selected.input.enabled && !!selected.input.owner &&
      selected.input.generation > 0 && selected.input.storage.isCurrent() && selected.input.isCurrentAccount() && AppState.currentState === "active";
  };
  return {
    messageId: state.scope === scope ? state.messageId : null,
    error: state.scope === scope || state.phase === "stop_failed" ? state.error : "",
    stopFailed: state.phase === "stop_failed",
    retryStop() {
      if (!activation || active.current !== activation || committed.current?.scope !== scope || device.snapshot().phase !== "stop_failed") return Promise.resolve();
      return stopCoachReadAloud();
    },
    busy: state.phase === "starting" || state.phase === "stopping" || state.phase === "stop_failed",
    stop,
    read(message: CoachMessage) { if (current() && message.generation === input.generation) device.begin({ scope, current, message }); },
  };
}

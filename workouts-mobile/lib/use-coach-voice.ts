import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { coachVoice } from "./coach-speech-recognition";

type Options = { scope: string; identity: unknown; enabled: boolean; message: string; current(): boolean; write(value: string): void; beforeCapture?(): Promise<void> };
export function useCoachVoice(options: Options) {
  const committed = useRef<{ options: Options; valid: boolean } | null>(null);
  const focused = useRef(false), preparation = useRef<object | null>(null);
  const [preparing, setPreparing] = useState(false), [preparationError, setPreparationError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const state = useSyncExternalStore(coachVoice.subscribe, coachVoice.snapshot, coachVoice.snapshot);
  function cancelPreparation() { preparation.current = null; setPreparing(false); }
  useLayoutEffect(() => {
    const previous = committed.current;
    const valid = options.enabled && options.current();
    committed.current = { options, valid };
    if (previous?.valid && !valid) { cancelPreparation(); coachVoice.cancel(previous.options.scope); }
  });
  useLayoutEffect(() => {
    setSettingsError(""); setPreparationError(""); cancelPreparation();
    coachVoice.clear(options.scope);
    return () => { committed.current = null; preparation.current = null; coachVoice.cancel(options.scope); };
  }, [options.scope, options.identity, options.enabled]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const subscription = AppState.addEventListener("change", state => {
      // An OS permission dialog can temporarily make iOS inactive. Backgrounding
      // still retires it; active dictation also stops for other interruptions.
      if (state === "background" || (state !== "active" && coachVoice.snapshot().phase !== "permission")) {
        cancelPreparation(); coachVoice.cancel(options.scope);
      }
    });
    return () => { focused.current = false; preparation.current = null; coachVoice.cancel(options.scope); subscription.remove(); };
  }, [options.scope]));
  function current(scope: string, identity = options.identity) {
    const value = committed.current;
    return !!value && value.valid && value.options.scope === scope && value.options.identity === identity && value.options.enabled && focused.current &&
      AppState.currentState === "active" && value.options.current();
  }
  const own = state.scope === options.scope;
  return {
    phase: own ? state.phase : "idle", preparing,
    unavailable: state.phase !== "idle" && !own,
    guidance: own ? state.guidance : null,
    settingsError, preparationError,
    cancel() {
      const selected = committed.current;
      if (selected?.options.scope !== options.scope || selected.options.identity !== options.identity || !options.current()) return;
      cancelPreparation(); coachVoice.cancel(options.scope);
    },
    toggle() {
      if (!options.current() || !current(options.scope, options.identity)) return;
      if (preparation.current) { cancelPreparation(); return; }
      if (state.phase !== "idle") { coachVoice.stop(options.scope); return; }
      const captured = committed.current?.options;
      if (!captured || !current(captured.scope)) return;
      const attempt = {}; preparation.current = attempt; setPreparing(true); setPreparationError("");
      // Freeze text/scope before both speech-stop and the OS permission awaits.
      void (async () => {
        try {
          await captured.beforeCapture?.();
          if (preparation.current !== attempt || !current(captured.scope, captured.identity)) return;
          void coachVoice.begin({ scope: captured.scope, base: captured.message,
            current: () => current(captured.scope, captured.identity),
            write: text => { if (current(captured.scope, captured.identity)) captured.write(text); },
          });
        } catch {
          if (preparation.current === attempt && current(captured.scope, captured.identity))
            setPreparationError("Could not confirm speech stopped. Retry stopping speech before dictating, or type your message.");
        } finally {
          if (preparation.current === attempt) { preparation.current = null; setPreparing(false); }
        }
      })();
    },
    async settings() {
      if (!current(options.scope)) return;
      try { await Linking.openSettings(); }
      catch { if (current(options.scope)) setSettingsError("Could not open Settings. You can type your message instead."); }
    },
  };
}

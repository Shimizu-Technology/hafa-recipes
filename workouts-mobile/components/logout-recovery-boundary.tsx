import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { LogoutAuth, LogoutRecovery, LogoutAcknowledgement } from "../lib/logout-recovery";

/** Lives under Clerk/QueryClient and above TrainingProvider, including cold startup. */
export function LogoutRecoveryBoundary({ controller, auth, signOut, clearPrivate, renderRecovery, children }: {
  controller: LogoutRecovery;
  auth: LogoutAuth;
  signOut(options: { sessionId: string }): Promise<void>;
  clearPrivate(record: LogoutAcknowledgement): void;
  renderRecovery(state: { checking: boolean; loading: boolean; busy: boolean; error: string; retry(): void }): ReactNode;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const live = useRef({ auth, signOut, clearPrivate });
  live.current = { auth, signOut, clearPrivate };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const attempted = useRef(new Set<string>());
  const record = state.records.find((item) => item.binding === auth.binding && item.subject === auth.subject)
    ?? (auth.loaded && !auth.subject ? state.records[0] : undefined);
  useEffect(() => { void controller.hydrate(); }, [controller]);
  function retry() {
    if (!state.ready) { void controller.hydrate(); return; }
    if (record) void controller.retry(record, {
      auth: () => mounted.current ? live.current.auth : { loaded: false, binding: null, subject: null, sessionId: null },
      clearPrivate: (value) => live.current.clearPrivate(value),
      signOut: (options) => live.current.signOut(options),
    });
  }
  useEffect(() => {
    if (!state.ready || !auth.loaded || !record || state.busy) return;
    const key = `${record.binding}:${record.sessionId}:${auth.sessionId ?? "signed-out"}`;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    retry();
  }, [controller, state.ready, auth.loaded, auth.binding, auth.subject, auth.sessionId, record, state.busy]);
  if (!state.ready || record) return renderRecovery({
    checking: !state.ready,
    loading: !state.ready && !state.error,
    busy: !!state.busy,
    error: state.error,
    retry,
  });
  return children;
}

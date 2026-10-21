import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useAuth, useClerk, useSession } from "@clerk/expo";
import { ApiError, createWorkoutsApi } from "../lib/api";
import { configuration } from "../lib/config";
import { revokeNativeSharing } from "../lib/native-share-session";
import { signupSetup } from "../lib/signup-setup";
import { Button, Copy, Notice, Screen } from "./ui";

/** Explicit new-account intent must finish before any private training queries. */
export function SignupGate({ children }: PropsWithChildren) {
  const { isLoaded, sessionId, userId, getToken } = useAuth(), clerk = useClerk();
  const { isLoaded: sessionLoaded, session } = useSession();
  const scope = sessionId && userId ? `${sessionId}:${userId}` : null;
  const [readyScope, setReadyScope] = useState<string | null>(null),
    [busy, setBusy] = useState(true), [error, setError] = useState(""),
    [needsFinish, setNeedsFinish] = useState(false);
  const live = useRef({ sessionId, userId, session, getToken });
  live.current = { sessionId, userId, session, getToken };
  const retry = useRef(async (_finish = false) => {}), leave = useRef(async () => {});
  const hydrated = isLoaded && sessionLoaded && !!sessionId && !!userId &&
    session?.id === sessionId && session.user.id === userId &&
    clerk.session?.id === sessionId && clerk.session.user.id === userId;
  useEffect(() => {
    if (configuration.clerkEnvironment !== "production" || !hydrated) return;
    let active = true, working = false;
    const current = () => active && live.current.sessionId === sessionId && live.current.userId === userId &&
      live.current.session?.id === sessionId && live.current.session.user.id === userId &&
      clerk.session?.id === sessionId && clerk.session.user.id === userId;
    const binding = `${sessionId}:${userId}`;
    const api = createWorkoutsApi(configuration.apiBase, () => live.current.getToken(), fetch,
      { binding, currentBinding: () => current() ? binding : null });
    async function run(finish = false) {
      if (working || !current() || !sessionId || !userId) return;
      working = true; setBusy(true); setError("");
      try {
        let pending = await signupSetup.pending(sessionId, userId);
        if (!current()) return;
        if (!pending && await signupSetup.recoverable(userId)) {
          if (!current()) return;
          setNeedsFinish(true);
          if (!finish) return;
          await signupSetup.begin(sessionId, userId);
          pending = true;
        }
        if (!current()) return;
        setNeedsFinish(false);
        if (pending) await signupSetup.complete(sessionId, userId, api.onboard, current);
        if (current()) setReadyScope(binding);
      } catch (failure) {
        if (current()) setError(failure instanceof ApiError && failure.status === 409
          ? "This Håfa account needs recovery. Use your existing account or contact support."
          : "Your sign-in is saved, but account setup could not finish. Try again when online and your device is unlocked.");
      } finally { working = false; if (active) setBusy(false); }
    }
    retry.current = run;
    leave.current = async () => {
      if (working || !current() || !sessionId || !userId) return;
      working = true; setBusy(true); setError("");
      try {
        await revokeNativeSharing();
        if (!current()) return;
        await clerk.signOut();
        await signupSetup.clear(sessionId, userId);
      } catch { if (current()) setError("Sign-out needs another attempt."); }
      finally { working = false; if (active) setBusy(false); }
    };
    void run();
    return () => { active = false; };
  }, [hydrated, sessionId, userId]);
  if (configuration.clerkEnvironment !== "production" || (hydrated && !!scope && readyScope === scope)) return children;
  return <Screen title={needsFinish ? "Finish account setup" : "Getting your account ready"}>
    {(busy || !hydrated) && <Copy>Preparing your private Håfa account…</Copy>}
    {!busy && needsFinish && <Copy>Your account was created, but setup is unfinished. Finish setup to start using Workouts.</Copy>}
    {!!error && <Notice error>{error}</Notice>}
    {!busy && hydrated && <Button title={needsFinish ? "Finish account setup" : "Try again"} secondary
      onPress={() => void retry.current(needsFinish)} />}
    {!busy && hydrated && <Button title="Sign out" variant="ghost" onPress={() => void leave.current()} />}
  </Screen>;
}

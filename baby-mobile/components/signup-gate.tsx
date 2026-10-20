import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useAuth, useClerk } from "@clerk/expo";
import { ApiError, createBabyApi } from "../lib/api";
import { configuration } from "../lib/config";
import { signupSetup } from "../lib/signup-setup";
import { Button, Loading, Notice, Screen } from "./ui";

/** Keep private queries closed until this exact explicit signup is provisioned. */
export function SignupGate({ children }: PropsWithChildren) {
  const { sessionId, userId, getToken } = useAuth(), clerk = useClerk();
  const [ready, setReady] = useState(configuration.clerkEnvironment !== "production"),
    [busy, setBusy] = useState(configuration.clerkEnvironment === "production"), [error, setError] = useState(""),
    [hasIntent, setHasIntent] = useState(false);
  const retry = useRef(async () => {}), leave = useRef(async () => {});
  useEffect(() => {
    if (configuration.clerkEnvironment !== "production") return;
    let active = true, working = false;
    const current = () => active && !!sessionId && !!userId &&
      clerk.session?.id === sessionId && clerk.session.user.id === userId;
    const api = createBabyApi(configuration.apiBase, () => getToken(), current);
    async function run() {
      if (working) return;
      working = true; setBusy(true); setError("");
      try {
        if (!current() || !sessionId || !userId) throw Error("Account changed");
        const pending = await signupSetup.pending(sessionId, userId);
        if (!current()) return;
        setHasIntent(pending);
        if (pending) await signupSetup.complete(sessionId, userId, api.onboard, current);
        if (current()) setReady(true);
      } catch (failure) {
        if (active) setError(failure instanceof ApiError && failure.status === 409
          ? "This Håfa account needs recovery. Sign in to your existing account or contact support."
          : "We couldn’t verify account setup. Please try again when your device is unlocked and online.");
      } finally {
        working = false;
        if (active) setBusy(false);
      }
    }
    retry.current = run;
    leave.current = async () => {
      if (working || !current() || !sessionId || !userId) return;
      working = true; setBusy(true); setError("");
      try {
        // Only a pending new signup reaches this control; Baby data has not been opened.
        await clerk.signOut();
        await signupSetup.clear(sessionId, userId);
      } catch {
        if (current()) setError("Sign-out needs another attempt.");
      } finally {
        working = false;
        if (active) setBusy(false);
      }
    };
    void run();
    return () => { active = false; };
  }, [sessionId, userId]);
  if (ready) return children;
  return <Screen title="Getting your account ready">
    {busy && <Loading />}
    {!!error && <Notice error>{error}</Notice>}
    {!busy && <Button title="Try again" secondary onPress={() => void retry.current()} />}
    {hasIntent && !busy && <Button title="Sign out" variant="ghost" busy={busy} onPress={() => void leave.current()} />}
  </Screen>;
}

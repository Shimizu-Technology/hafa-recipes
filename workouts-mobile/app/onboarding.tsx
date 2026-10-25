import { pendingShare } from "@/lib/sharing";
import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { saveAccountSetup } from "@/lib/onboarding-state";
import { Button, Choice, Copy, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
export default function Onboarding() {
  const params = useLocalSearchParams<{ return_to?: string; include?: string; workout_id?: string; program_id?: string; session_id?: string; revision?: string }>();
  const { api, enrollment, enrollmentQuery, storage, completeSetup, beginSetup, isCurrentAccount } = useTraining();
  const { hasShareIntent } = useShareIntentContext();
  const nativeShare = useRef(hasShareIntent);
  nativeShare.current = hasShareIntent;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [adult, setAdult] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  async function join() {
    if (guard.current) return;
    if (!adult || !acknowledged) { setError("Confirm both choices to continue."); return; }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const expected = enrollment?.generation ?? null;
      await saveAccountSetup({
        adultConfirmed: adult, sharedDeletionAcknowledged: acknowledged,
        expectedGeneration: expected, api, setup: beginSetup(expected),
        guard() {
          if (!alive.current || !storage.isCurrent() || !isCurrentAccount())
            throw Error("Your account or device state changed. Setup was stopped.");
        },
        complete: (member) => completeSetup(member, undefined, expected, "account-setup"),
      });
      if (!isCurrentAccount()) return;
      const token = pendingShare();
      if (token) router.replace({ pathname: "/shared/[token]", params: { token } });
      else if (!nativeShare.current) {
        if (params.return_to === "coach" || params.return_to === "build-plan")
          router.replace({ pathname: "/profile", params });
        else router.replace("/(tabs)/library");
      }
      // ShareCapture retains and opens the native source after verified enrollment.
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Try joining again.");
    } finally {
      guard.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return <Screen back title="Join Håfa Workouts">
    <Copy>Save workouts from links, photos or your own notes. Add goals and a plan whenever you like.</Copy>
    <Choice label="I am 18 or older" selected={adult} disabled={busy} onPress={() => setAdult(!adult)} />
    <Notice>One Håfa account works across Håfa apps, and each app’s data stays separate unless you connect them. Deleting the whole account from any Håfa app deletes your data in all of them; you can instead remove just your Workouts data and keep your account.</Notice>
    <Choice label="I understand how my shared account works" selected={acknowledged} disabled={busy} onPress={() => setAcknowledged(!acknowledged)} />
    {enrollmentQuery.error && <Notice error>{enrollmentQuery.error.message}</Notice>}
    {!!error && <><Notice error>{error}</Notice><Button title="Refresh account setup" secondary disabled={busy} onPress={() => { void enrollmentQuery.refetch(); }} /></>}
    <Button title="Get started" icon="checkmark" busy={busy} disabled={!adult || !acknowledged || enrollmentQuery.isPending || !enrollmentQuery.data} onPress={() => { void join(); }} />
  </Screen>;
}

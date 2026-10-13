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
    if (!adult || !acknowledged) { setError("Confirm both choices to start saving workouts."); return; }
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
  return <Screen back title="Start saving workouts." subtitle="Two apps. One Håfa account.">
    <Copy>Save a workout from a link, photo or your own notes. You can set up goals and a training plan whenever you want.</Copy>
    <Choice label="I am 18 or older" selected={adult} disabled={busy} onPress={() => setAdult(!adult)} />
    <Notice>Recipes and Workouts use one account. Your data stays separate unless you connect it. Deleting your whole Håfa account from either app, including older Recipes versions, deletes both products’ data. You can remove one product’s data separately and keep your account.</Notice>
    <Choice label="I understand how my shared account works" selected={acknowledged} disabled={busy} onPress={() => setAcknowledged(!acknowledged)} />
    {enrollmentQuery.error && <Notice error>{enrollmentQuery.error.message}</Notice>}
    {!!error && <><Notice error>{error}</Notice><Button title="Refresh account setup" secondary disabled={busy} onPress={() => { void enrollmentQuery.refetch(); }} /></>}
    <Button title="Start saving workouts" icon="checkmark" busy={busy} disabled={!adult || !acknowledged || enrollmentQuery.isPending || !enrollmentQuery.data} onPress={() => { void join(); }} />
  </Screen>;
}

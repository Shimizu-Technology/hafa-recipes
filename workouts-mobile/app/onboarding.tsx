import { profileMeasurementErrors } from "@/lib/measurements";
import { pendingShare } from "@/lib/sharing";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { saveTrainingSetup } from "@/lib/onboarding-state";
import { Button, Choice, Copy, Notice, Screen } from "@/components/ui";
import { ProfileForm } from "@/components/profile-form";
import { useTraining } from "@/lib/context";
import { initialProfile, profileErrors, type TrainingProfile } from "@/lib/models";
export default function Onboarding() {
  const { localDrafts, api, owner, enrollment, enrollmentQuery, storage, completeSetup, beginSetup, isCurrentAccount } = useTraining();
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );
  const [profile, setProfile] = useState(initialProfile);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftScope = `profile:${enrollment?.generation ?? "new"}`;
  const [scope, setScope] = useState(false);
  const guard = useRef(false);
  useEffect(() => {
    let active = true;
    void localDrafts
      .load<TrainingProfile>(owner, draftScope)
      .then((p) => {
        if (active) {
          if (p) setProfile(p);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setLoaded(true);
          setError("Could not restore your local draft. You can enter your profile again.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, draftScope]);
  function update(p: TrainingProfile) {
    if (guard.current) return;
    setProfile(p);
    void localDrafts
      .save(owner, draftScope, p)
      .catch(() => setError("Could not keep this draft on your device. Stay here until it is saved."));
  }
  async function save() {
    if (guard.current) return;
    const errors = [...profileErrors(profile), ...profileMeasurementErrors(profile)];
    if (!scope) errors.push("Acknowledge the shared-account deletion policy.");
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await saveTrainingSetup({
        profile,
        expected_generation: enrollment?.generation ?? null,
        owner,
        drafts: localDrafts,
        api,
        setup: beginSetup(enrollment?.generation ?? null),
        guard() {
          if (!alive.current || !storage.isCurrent())
            throw Error("The account, enrollment or device state changed. Your setup was stopped.");
        },
        complete: (member, saved) => completeSetup(member, saved, enrollment?.generation ?? null, draftScope),
      });
      const pending = pendingShare();
      if (isCurrentAccount())
        router.replace(pending ? { pathname: "/shared/[token]", params: { token: pending } } : "/(tabs)");
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Your draft is safe. Try saving again.");
    } finally {
      guard.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Screen
      back
      title={["Training for you.", "Make it fit.", "A little more context."][step]}
      subtitle={`Step ${step + 1} of 3 · Your draft stays on this device.`}
    >
      {!loaded ? (
        <Copy>Loading your saved draft…</Copy>
      ) : (
        <View pointerEvents={busy ? "none" : "auto"}>
          <ProfileForm section={step} value={profile} update={update} />
        </View>
      )}
      {step === 2 && (
        <>
          <Choice
            label="I am 18 or older"
            selected={profile.adult_confirmed}
            onPress={() => update({ ...profile, adult_confirmed: !profile.adult_confirmed })}
          />
          <Notice>
            One Håfa account gives you access to Recipes and Workouts. Data stays separate unless connected. Deleting
            the whole account from either app, including older Recipes versions, deletes both products’ data. Separate
            product-data controls preserve your login and the other app.
          </Notice>
          <Choice label="I understand how my shared account works" selected={scope} onPress={() => setScope(!scope)} />
        </>
      )}
      {enrollmentQuery.error && <Notice error>{enrollmentQuery.error.message}</Notice>}
      {!!error && (
        <>
          <Notice error>{error}</Notice>
          <Button
            title="Reload saved enrollment before retrying"
            secondary
            disabled={busy}
            onPress={() => {
              void enrollmentQuery.refetch();
            }}
          />
        </>
      )}
      <Button
        title={step === 2 ? "Save my training profile" : "Continue"}
        disabled={!loaded || enrollmentQuery.isPending || !enrollmentQuery.data}
        busy={busy}
        onPress={() => {
          setError("");
          if (step < 2) setStep(step + 1);
          else void save();
        }}
      />
      {step > 0 && <Button title="Previous step" secondary disabled={busy} onPress={() => setStep(step - 1)} />}
    </Screen>
  );
}

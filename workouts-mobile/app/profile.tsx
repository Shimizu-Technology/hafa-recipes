import { View } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { AccountButton, Button, Empty, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { createPrivateForm } from "@/lib/private-form";
import { ProfileForm } from "@/components/profile-form";
import { useTraining } from "@/lib/context";
import { profileMeasurementErrors } from "@/lib/measurements";
import { initialProfile, profileErrors, type TrainingProfile } from "@/lib/models";
import type { ProfileSnapshot } from "@/lib/api";
interface ProfileEdit {
  value: TrainingProfile;
  revision: number | null;
  generation: number;
}
export default function Profile() {
  const params = useLocalSearchParams<{ return_to?: string; include?: string; workout_id?: string; program_id?: string; session_id?: string; revision?: string }>();
  function continueAfterSave() {
    if (params.return_to === "build-plan") router.replace({ pathname: "/build-plan", params: params.include ? { include: params.include } : {} });
    else if (params.return_to === "coach") router.replace({ pathname: "/coach", params: {
      ...(params.workout_id ? { workout_id: params.workout_id } : {}),
      ...(params.program_id ? { program_id: params.program_id } : {}),
      ...(params.session_id ? { session_id: params.session_id } : {}),
      ...(params.revision ? { revision: params.revision } : {}),
    } });
  }

  const { storage, api, owner, enrollment, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "profile", enrollment?.generation, "snapshot"],
    queryFn: api.profileSnapshot,
    enabled: !!enrollment?.enrolled
  });
  const generation = enrollment?.generation ?? 0;
  const scope = `profile-edit:${enrollment?.generation ?? "none"}`;
  const form = useMemo(
    () => createPrivateForm<ProfileEdit, ProfileEdit>(storage, owner, scope),
    [storage, owner, scope]
  );
  const [value, setValue] = useState<TrainingProfile | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [command, setCommand] = useState<ProfileEdit | null>(null);
  const [resolved, setResolved] = useState(false);
  const sealed = useRef(false);
  sealed.current = !!command || resolved;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  const live = useRef(scope);
  live.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function current() {
    if (!mounted.current || live.current !== scope || !storage.isCurrent() || !isCurrentAccount())
      throw Error("Your account or training setup changed. This profile edit was stopped.");
  }
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setValue(null);
    setCommand(null);
    setResolved(false);
    void form
      .load()
      .then(async (box) => {
        if (!active) return;
        // Arriving from Coach or plan building to fix something: start from the saved profile, ready to edit.
        if (box.terminal && params.return_to) {
          await form.reset();
          if (!active) return;
          setLoaded(true);
          return;
        }
        if (box.input?.generation === generation) {
          setValue(box.input.value);
          setRevision(box.input.revision);
        }
        setCommand(box.command);
        setResolved(box.terminal);
        setLoaded(true);
      })
      .catch(() => {
        if (active) {
          setLoaded(true);
          setMessage("Could not restore your edit. Inspect the saved profile before making changes.");
        }
      });
    return () => {
      active = false;
    };
  }, [form, generation, params.return_to]);
  useEffect(() => {
    // Background refetch may update the comparison baseline, never a live/pending draft.
    if (loaded && !value && !command && q.data) {
      setValue(q.data.profile ?? { ...initialProfile(), adult_confirmed: true });
      setRevision(q.data.revision);
    }
  }, [loaded, value, command, resolved, q.data]);
  function cacheSnapshot(snapshot: ProfileSnapshot) {
    cache.setQueryData<ProfileSnapshot>([owner, "profile", generation, "snapshot"], (prior) =>
      prior && prior.revision > snapshot.revision ? prior : snapshot
    );
    // Today/onboarding use a legacy content-only cache. Refetch it rather than
    // giving it a different shape or replacing a newer profile with this receipt.
    void cache.invalidateQueries({ queryKey: [owner, "profile", generation], exact: true });
  }
  function update(p: TrainingProfile) {
    if (guard.current || sealed.current || !loaded) return;
    try {
      current();
    } catch {
      return;
    }
    setValue(p);
    setMessage("");
    void form
      .save({ value: p, revision, generation })
      .catch(() => setMessage("Could not keep this draft locally. Stay here until saved."));
  }
  async function reloadSaved() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      current();
      const fresh = await api.profileSnapshot();
      current();
      await form.reset();
      current();
      const next = fresh.profile ?? { ...initialProfile(), adult_confirmed: true };
      await form.save({ value: next, revision: fresh.revision, generation });
      current();
      setValue(next);
      setRevision(fresh.revision);
      setCommand(null);
      setResolved(false);
      cacheSnapshot(fresh);
      setConflict(false);
      setMessage("The latest saved profile is shown. Your previous draft was discarded.");
    } catch (e) {
      if (mounted.current) setMessage((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (!value || guard.current || resolved) return;
    if (!command) {
      const errors = [...profileErrors(value), ...profileMeasurementErrors(value, q.data?.profile)];
      if (errors.length) {
        setMessage(errors.join(" "));
        return;
      }
    }
    guard.current = true;
    setBusy(true);
    try {
      current();
      const frozen = await form.begin({ value, revision, generation }, command ?? { value, revision, generation });
      current();
      setCommand(frozen);
      const p = await api.saveProfileSnapshot(frozen.value, frozen.revision, frozen.generation);
      current();
      await form.complete(frozen);
      current();
      setCommand(null);
      setResolved(true);
      setValue(p.profile);
      setRevision(p.revision);
      cacheSnapshot(p);
      setConflict(false);
      setMessage("Your training profile is saved.");
      continueAfterSave();
    } catch (e) {
      if (mounted.current) {
        if ((e as { status?: number }).status === 409) setConflict(true);
        setMessage((e as Error).message);
      }
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen
      back
      title={q.data?.profile ? "Training profile" : "Set up training"}
      subtitle="Choose your goal, equipment and usual schedule. Personal details are optional."
      action={<AccountButton />}
    >
      <QueryState
        loading={!loaded || (q.isPending && !!enrollment?.enrolled && !value)}
        error={value ? null : q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {value ? (
          <>
            <View pointerEvents={busy ? "none" : "auto"}>
              <ProfileForm expandDetails={params.return_to === "coach"} value={value} baseline={q.data?.profile} update={update} disabled={busy || !!command || resolved} />
            </View>
            {((q.data?.profile?.weight_kg != null && value.weight_kg == null) ||
              (q.data?.profile?.height_cm != null && value.height_cm == null)) && (
              <Notice>
                Clearing a current measurement keeps its history, and clears saved AI context and pending proposals that
                used it. Completed training stays recorded. Use Measurement history to remove the historical value
                itself.
              </Notice>
            )}
            {!!message && <Notice>{message}</Notice>}
            {(conflict || command) && (
              <>
                <Notice>
                  These profile changes are saved on this device. Retry sends the same details. If you did not receive a
                  save confirmation or the saved profile changed, reload the saved profile before discarding this draft.
                </Notice>
                <Button
                  title="Reload saved profile and discard this draft"
                  secondary
                  busy={busy}
                  onPress={() => {
                    void reloadSaved();
                  }}
                />
              </>
            )}
            {resolved && (
              <Button
                title="Edit these saved preferences"
                secondary
                disabled={busy}
                onPress={() => {
                  void (async () => {
                    current();
                    await form.reset();
                    current();
                    setResolved(false);
                  })().catch((e) => setMessage(e.message));
                }}
              />
            )}
            <Button
              title={command ? "Retry saving profile" : "Save profile"}
              disabled={resolved}
              busy={busy}
              onPress={() => {
                void save();
              }}
            />
          </>
        ) : (
          <Empty
            icon="person-outline"
            title="Set your training foundation"
            description="Join Workouts to save workouts. Set up training whenever you want."
            action={<Button title="Join Workouts" onPress={() => router.push("/onboarding")} />}
          />
        )}
      </QueryState>
    </Screen>
  );
}

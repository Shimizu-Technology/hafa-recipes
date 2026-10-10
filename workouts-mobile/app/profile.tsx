import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Empty, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { ProfileForm } from "@/components/profile-form";
import { useTraining } from "@/lib/context";
import { profileMeasurementErrors } from "@/lib/measurements";
import { profileErrors, type TrainingProfile } from "@/lib/models";
export default function Profile() {
  const { localDrafts, api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "profile", enrollment?.generation],
    queryFn: api.profile,
    enabled: !!enrollment?.enrolled,
  });
  const [value, setValue] = useState<TrainingProfile | null>(null);
  const scope = `profile-edit:${enrollment?.generation ?? "none"}`;
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const guard = useRef(false);
  async function reloadSaved() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      const fresh = await api.profile();
      await localDrafts.remove(owner, scope);
      setValue(fresh);
      setRevision(api.profileRevision());
      cache.setQueryData([owner, "profile", enrollment?.generation], fresh);
      setConflict(false);
      setMessage("The latest saved profile is shown. The previous edit draft was discarded.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void localDrafts
      .load<{ value: TrainingProfile; revision: number; generation: number }>(owner, scope)
      .then((draft) => {
        if (active) {
          setValue(draft && draft.generation === enrollment?.generation ? draft.value : (q.data ?? null));
          setRevision(draft && draft.generation === enrollment?.generation ? draft.revision : api.profileRevision());
        }
      })
      .catch(() => {
        if (active) {
          setValue(q.data ?? null);
          setMessage("Could not restore your edit draft. Your saved profile is shown.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, q.data, scope]);
  function update(p: TrainingProfile) {
    setValue(p);
    setMessage("");
    void localDrafts
      .save(owner, scope, { value: p, revision, generation: enrollment?.generation })
      .catch(() => setMessage("Could not keep this draft locally. Stay here until saved."));
  }
  async function save() {
    if (!value || guard.current) return;
    const errors = [...profileErrors(value), ...profileMeasurementErrors(value, q.data)];
    if (errors.length) {
      setMessage(errors.join(" "));
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      const p = await api.saveProfile(value, revision, enrollment?.generation ?? undefined);
      await localDrafts.remove(owner, scope);
      setRevision(api.profileRevision());
      cache.setQueryData([owner, "profile", enrollment?.generation], p);
      setConflict(false);
      setMessage("Your training profile is saved.");
    } catch (e) {
      if ((e as { status?: number }).status === 409) setConflict(true);
      setMessage(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      title="Your training profile."
      subtitle="The context you have chosen to share. Edit or remove optional details any time."
      action={<Button title="Account" secondary onPress={() => router.push("/settings")} />}
    >
      <QueryState
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {value ? (
          <>
            <ProfileForm value={value} baseline={q.data} update={update} />
            {((q.data?.weight_kg != null && value.weight_kg == null) ||
              (q.data?.height_cm != null && value.height_cm == null)) && (
              <Notice>
                Clearing a current measurement keeps its history, and clears saved AI context and pending proposals that
                used it. Completed training stays recorded. Use Measurement history to remove the historical value
                itself.
              </Notice>
            )}
            {!!message && <Notice>{message}</Notice>}
            {conflict && (
              <>
                <Notice>
                  Your saved context changed. This draft retains its original revision; it has not overwritten the newer
                  profile.
                </Notice>
                <Button
                  title="Reload saved profile and discard this edit draft"
                  secondary
                  busy={busy}
                  onPress={() => {
                    void reloadSaved();
                  }}
                />
              </>
            )}
            <Button
              title="Save profile"
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
            description="Start with a goal and a schedule that fits your life."
            action={<Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
          />
        )}
      </QueryState>
    </Screen>
  );
}

import { View } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Empty, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { createPrivateForm } from "@/lib/private-form";
import { ProfileForm } from "@/components/profile-form";
import { useTraining } from "@/lib/context";
import { profileMeasurementErrors } from "@/lib/measurements";
import { profileErrors, type TrainingProfile } from "@/lib/models";
import type { ProfileSnapshot } from "@/lib/api";
interface ProfileEdit {
  value: TrainingProfile;
  revision: number | null;
  generation: number;
}
export default function Profile() {
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
      .then((box) => {
        if (!active) return;
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
  }, [form, generation]);
  useEffect(() => {
    // Background refetch may update the comparison baseline, never a live/pending draft.
    if (loaded && !value && !command && q.data) {
      setValue(q.data.profile);
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
      if (fresh.profile) await form.save({ value: fresh.profile, revision: fresh.revision, generation });
      current();
      setValue(fresh.profile);
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
      title="Your training profile."
      subtitle="The context you have chosen to share. Edit or remove optional details any time."
      action={<Button title="Account" secondary onPress={() => router.push("/settings")} />}
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
              <ProfileForm value={value} baseline={q.data?.profile} update={update} disabled={busy || !!command || resolved} />
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
            description="Start with a goal and a schedule that fits your life."
            action={<Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
          />
        )}
      </QueryState>
    </Screen>
  );
}

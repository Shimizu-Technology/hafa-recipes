import { useEffect, useMemo, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { RecordedTime } from "@/components/recorded-time";
import { QueryState } from "@/components/query-state";
import { createPrivateForm } from "@/lib/private-form";
import { useTraining } from "@/lib/context";
import {
  measurementErrors,
  measurementDisplay,
  type MeasurementKind,
  type MeasurementUnit,
  type MeasurementWrite
} from "@/lib/measurements";
interface Operation {
  kind: "save" | "remove";
  profile_revision: number;
  generation: number;
  body: MeasurementWrite | { request_id: string; expected_revision: number };
}
interface Draft {
  generation: number;
  kind: MeasurementKind;
  value: string;
  unit: MeasurementUnit;
  recorded_at: string | null;
  update_current: boolean;
  profile_revision: number;
  measurement_revision?: number;
  operation?: Operation;
}
export default function MeasurementEditor() {
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const id = params.id ?? null;
  const kind: MeasurementKind = params.kind === "height" ? "height" : "weight";
  const { storage, api, owner, enrollment, units, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const scope = `measurement:${id ?? kind}:${generation}`;
  const cache = useQueryClient();
  const form = useMemo(() => createPrivateForm<Draft, Operation>(storage, owner, scope), [storage, owner, scope]);
  const [finished, setFinished] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const live = useRef(scope);
  live.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function guard() {
    if (!mounted.current || live.current !== scope || !storage.isCurrent() || !isCurrentAccount())
      throw Error("Your account, measurement or training setup changed. This measurement edit was stopped.");
  }
  const profile = useQuery({
    queryKey: [owner, "measurement-profile", generation],
    queryFn: api.profileSnapshot,
    enabled: !!enrollment?.enrolled
  });
  const entry = useQuery({
    queryKey: [owner, "measurement", id, generation],
    queryFn: () => api.measurement(id!, generation),
    enabled: !!id && !!enrollment?.enrolled
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Operation | null>(null);
  const retired = useRef<string | null>(null);
  const sealed = useRef(false);
  sealed.current = finished || !!draft?.operation || !!pendingRemoval;
  if (entry.data?.status === "removed") retired.current = scope;
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setDraft(null);
    setPendingRemoval(null);
    setRestored(false);
    setFinished(false);
    void form
      .load()
      .then(async (box) => {
        if (active) {
          if (box.removed) retired.current = scope;
          if (retired.current !== scope && box.command?.kind === "remove" && box.command.generation === generation) {
            // Old drafts may contain private input beside the original removal.
            // Hide it immediately, and durably scrub it before another transport.
            setPendingRemoval(box.command);
            try {
              await form.begin(null, box.command);
            } catch {
              if (active)
                setError(
                  "Could not clear the old measurement draft on this device. Retry removal will clear it before sending."
                );
            }
            if (!active) return;
          } else if (retired.current !== scope && box.input?.generation === generation)
            setDraft({ ...box.input, operation: box.command ?? undefined });
          setFinished(box.terminal || retired.current === scope);
          setRestored(true);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not restore this edit draft. Saved measurements are unchanged.");
          setRestored(true);
        }
      });
    return () => {
      active = false;
    };
  }, [form, generation]);
  useEffect(() => {
    if (
      !restored ||
      draft ||
      pendingRemoval ||
      finished ||
      entry.data?.status === "removed" ||
      !profile.data ||
      (id && !entry.data)
    )
      return;
    const saved = entry.data;
    setDraft({
      generation,
      kind: saved?.kind ?? kind,
      value: saved?.value == null ? "" : String(saved.value),
      unit:
        saved?.unit ?? (kind === "weight" ? (units === "imperial" ? "lb" : "kg") : units === "imperial" ? "in" : "cm"),
      recorded_at: saved?.recorded_at ?? new Date().toISOString(),
      update_current: !id,
      profile_revision: profile.data.revision,
      measurement_revision: saved?.revision
    });
  }, [restored, draft, pendingRemoval, finished, profile.data, entry.data, id, kind, units, generation]);
  useEffect(() => {
    if (draft && !finished && entry.data?.status !== "removed")
      void form.save(draft).catch(() => setError("Could not keep this edit on the device. Retry before leaving."));
  }, [draft, form, finished, entry.data?.status]);
  useEffect(() => {
    if (entry.data?.status !== "removed") return;
    retired.current = scope;
    sealed.current = true;
    setDraft(null);
    setPendingRemoval(null);
    setFinished(true);
    void retireDraft();
  }, [entry.data?.status, form]);
  async function retireDraft() {
    try {
      guard();
      await form.retire();
      guard();
      setCleanupFailed(false);
      setError("");
    } catch {
      if (mounted.current) {
        setCleanupFailed(true);
        setError("This measurement is removed. Device draft cleanup needs another attempt.");
      }
    }
  }
  function update(patch: Partial<Draft>) {
    if (!lock.current && !sealed.current && retired.current !== scope && !busy && draft)
      setDraft({ ...draft, ...patch });
  }
  function unitChange(unit: MeasurementUnit) {
    if (!draft) return;
    const value = Number(draft.value);
    const oldCanonical = draft.unit === "lb" ? value * 0.45359237 : draft.unit === "in" ? value * 2.54 : value;
    const converted = unit === "lb" ? oldCanonical / 0.45359237 : unit === "in" ? oldCanonical / 2.54 : oldCanonical;
    update({
      unit,
      value: draft.value.trim() && Number.isFinite(converted) ? String(Number(converted.toFixed(6))) : draft.value
    });
  }
  async function execute(operation: Operation) {
    if ((!draft && operation.kind !== "remove") || lock.current || finished || retired.current === scope) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      guard();
      const frozen = await form.begin(operation.kind === "remove" ? null : draft, operation);
      operation = frozen;
      guard();
      if (frozen.kind === "remove") {
        setPendingRemoval(frozen);
        setDraft(null);
      } else if (draft) setDraft({ ...draft, operation: frozen });
      const result =
        operation.kind === "remove"
          ? await api.removeMeasurement(
              id!,
              operation.body.request_id,
              operation.body.expected_revision!,
              operation.profile_revision,
              operation.generation
            )
          : await api.saveMeasurement(
              id,
              operation.body as MeasurementWrite,
              operation.profile_revision,
              operation.generation
            );
      guard();
      if (result.measurement.status === "removed") {
        // A server tombstone takes effect before any fallible device write/refetch.
        retired.current = scope;
        sealed.current = true;
        cache.setQueryData([owner, "measurement", result.measurement.id, generation], result.measurement);
        setDraft(null);
        setFinished(true);
        setPendingRemoval(null);
        setConfirmRemove(false);
        // Both this branch and the query effect use idempotent retirement, never
        // command-matching completion that could race against a removed box.
        await retireDraft();
      } else {
        await form.complete(operation, result.measurement.id);
        guard();
        cache.setQueryData([owner, "measurement", result.measurement.id, generation], result.measurement);
        setDraft(null);
        setFinished(true);
      }
      guard();
      cache.setQueryData([owner, "profile", generation], result.profile);
      await cache.invalidateQueries({ queryKey: [owner, "measurements"] });
      await cache.invalidateQueries({ queryKey: [owner, "measurement", id] });
      await cache.invalidateQueries({ queryKey: [owner, "measurement-profile"] });
      await cache.invalidateQueries({ queryKey: [owner, "program-proposals"] });
      setMessage(
        operation.kind === "remove"
          ? "Measurement removed. If it was selected as current, that profile value was cleared; no older value was selected automatically."
          : result.current_applied
            ? "Measurement saved and selected as current in your profile."
            : "Measurement saved in history. Your current profile value was kept."
      );
      setConfirmRemove(false);
    } catch (e) {
      setError((e as Error).message);
      setConflict([409, 428].includes((e as { status?: number }).status ?? 0));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    if (draft.operation) {
      await execute(draft.operation);
      return;
    }
    const errors = measurementErrors(draft.kind, draft.value, draft.unit, draft.recorded_at);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    await execute({
      kind: "save",
      profile_revision: draft.profile_revision,
      generation: draft.generation,
      body: {
        request_id: Crypto.randomUUID(),
        ...(id ? { expected_revision: draft.measurement_revision } : { kind: draft.kind }),
        value: Number(draft.value),
        unit: draft.unit,
        recorded_at: draft.recorded_at!,
        source: "user",
        update_current: draft.update_current
      }
    });
  }
  async function remove() {
    if (
      !draft || !id || draft.measurement_revision == null || lock.current || sealed.current || retired.current === scope
    )
      return;
    await execute({
      kind: "remove",
      profile_revision: draft.profile_revision,
      generation: draft.generation,
      body: { request_id: Crypto.randomUUID(), expected_revision: draft.measurement_revision }
    });
  }
  async function discardConflictedRemoval() {
    if (!id || !pendingRemoval || !conflict || lock.current || retired.current === scope) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      guard();
      const latest = await api.measurement(id, pendingRemoval.generation);
      guard();
      if (latest.status === "removed") {
        // Install the authoritative tombstone before disk cleanup or profile IO.
        retired.current = scope;
        sealed.current = true;
        setDraft(null);
        setPendingRemoval(null);
        setFinished(true);
        setConfirmRemove(false);
        setConflict(false);
        cache.setQueryData([owner, "measurement", id, generation], latest);
        await retireDraft();
        return;
      }
      const latestProfile = await api.profileSnapshot();
      guard();
      if (retired.current === scope) return;
      await form.reset();
      guard();
      if (retired.current === scope) return;
      cache.setQueryData([owner, "measurement", id, generation], latest);
      cache.setQueryData([owner, "measurement-profile", generation], latestProfile);
      setDraft({
        generation,
        kind: latest.kind,
        value: latest.value == null ? "" : String(latest.value),
        unit: latest.unit ?? (latest.kind === "weight" ? "kg" : "cm"),
        recorded_at: latest.recorded_at,
        update_current: latest.is_current,
        profile_revision: latestProfile.revision,
        measurement_revision: latest.revision
      });
      setPendingRemoval(null);
      setFinished(false);
      setConfirmRemove(false);
      setConflict(false);
      setMessage(
        "Saved measurement loaded. This device removal retry was discarded. Review it before making another change."
      );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function reloadRevisions() {
    if (!draft || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      guard();
      const [latestProfile, latestEntry] = await Promise.all([
        profile.refetch(),
        id ? entry.refetch() : Promise.resolve(null)
      ]);
      if (!latestProfile.data || (id && !latestEntry?.data))
        throw Error("Could not load current saved revisions. Your draft remains unchanged.");
      guard();
      if (latestEntry?.data?.status === "removed") {
        await form.retire();
        setDraft(null);
        setFinished(true);
        return;
      }
      await form.reset();
      guard();
      setDraft({
        ...draft,
        profile_revision: latestProfile.data.revision,
        measurement_revision: latestEntry?.data?.revision,
        operation: undefined
      });
      setError("");
      setFinished(false);
      setConflict(false);
      setMessage("Current saved revisions loaded. Review your draft against the current values before saving.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen
      back
      title={id ? "Review your measurement." : `Record your ${kind}.`}
      subtitle="Original units, exact dates and deliberate profile updates."
    >
      {!!message && <Notice>{message}</Notice>}
      {pendingRemoval && (
        <Card>
          <Notice>
            Your original removal request is kept for retry. The measurement editor is hidden while its outcome is
            uncertain. Retry sends the original removal request, even when saved measurements cannot be loaded.
          </Notice>
          <Button
            title="Retry this measurement removal"
            busy={busy}
            onPress={() => {
              void execute(pendingRemoval);
            }}
          />
        </Card>
      )}
      <QueryState
        loading={!restored || (!pendingRemoval && !finished && !draft && (profile.isPending || (!!id && entry.isPending)))}
        error={profile.error ?? entry.error}
        retry={() => {
          void profile.refetch();
          if (id) void entry.refetch();
        }}
      >
        {entry.data?.status === "removed" ? (
          <Notice>This measurement was removed. Its value and recorded date have been cleared.</Notice>
        ) : (
          !pendingRemoval && draft && (
            <>
              <Card>
                {entry.data && (
                  <Copy kind="small">
                    Currently saved · {measurementDisplay(entry.data)} ·{" "}
                    {entry.data.recorded_at ? new Date(entry.data.recorded_at).toLocaleString() : ""}
                  </Copy>
                )}
                <Field
                  disabled={busy || !!draft.operation}
                  label={draft.kind === "weight" ? "Measured weight" : "Measured height"}
                  numeric
                  value={draft.value}
                  onChange={(value) => update({ value })}
                />
                {(draft.kind === "weight" ? ["kg", "lb"] : ["cm", "in"]).map((unit) => (
                  <Choice
                    key={unit}
                    label={unit === "in" ? "inches" : unit}
                    disabled={busy || !!draft.operation}
                    selected={draft.unit === unit}
                    onPress={() => unitChange(unit as MeasurementUnit)}
                  />
                ))}
                <RecordedTime
                  label="When you took this measurement"
                  value={draft.recorded_at}
                  disabled={busy || !!draft.operation}
                  onChange={(recorded_at) => update({ recorded_at })}
                />
                <Choice
                  disabled={busy || !!draft.operation}
                  label="Use this as my current profile value"
                  detail="An earlier backfill never replaces a newer selected measurement."
                  selected={draft.update_current}
                  onPress={() => update({ update_current: !draft.update_current })}
                />
                {!!id && (
                  <Notice>
                    Correcting or removing a measurement clears saved AI context and pending proposals that used the old
                    value. Completed training stays recorded. Historical backfills remain separate from your current
                    profile unless you deliberately select a newer measurement.
                  </Notice>
                )}
                <Button
                  title={draft.operation ? "Retry this measurement change" : "Save measurement"}
                  busy={busy}
                  onPress={() => {
                    void save();
                  }}
                />
                {draft.operation && (
                  <Notice>
                    This measurement change is saved on your device. Retry sends the same details while its outcome is
                    uncertain.
                  </Notice>
                )}
              </Card>
              {!!(id && !draft.operation) && (
                <Card>
                  <Button
                    title="Remove this measurement"
                    secondary
                    disabled={busy}
                    onPress={() => setConfirmRemove(true)}
                  />
                  {confirmRemove && (
                    <>
                      <Notice>
                        Remove this value and its recorded date from history? If it is selected as current, your current
                        profile value will also clear without choosing an older entry. Saved AI context and pending
                        proposals using this value will be cleared. Completed training stays recorded.
                      </Notice>
                      <Button
                        title="Remove measurement and clear affected saved context"
                        secondary
                        busy={busy}
                        onPress={() => {
                          void remove();
                        }}
                      />
                      <Button
                        title="Keep measurement"
                        secondary
                        disabled={busy}
                        onPress={() => setConfirmRemove(false)}
                      />
                    </>
                  )}
                </Card>
              )}
            </>
          )
        )}
      </QueryState>
      {finished && retired.current !== scope && entry.data?.status !== "removed" && (
        <>
          <Notice>This measurement was saved. You can find it in your history.</Notice>
          <Button
            title={id ? "Review current saved measurement again" : "Record another measurement"}
            secondary
            disabled={busy}
            onPress={() => {
              void (async () => {
                guard();
                const latest = id ? await api.measurement(id, generation) : null;
                guard();
                if (latest?.status === "removed") {
                  cache.setQueryData([owner, "measurement", id, generation], latest);
                  await form.retire();
                  return;
                }
                await form.reset();
                guard();
                setDraft(null);
                setFinished(false);
              })().catch((e) => setError(e.message));
            }}
          />
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
      {cleanupFailed && (
        <Button
          title="Retry removed measurement device cleanup"
          secondary
          onPress={() => {
            void retireDraft();
          }}
        />
      )}
      {conflict && pendingRemoval && (
        <>
          <Notice>
            The saved measurement or profile changed. Reloading discards this device removal retry and shows the
            current saved measurement. It does not undo a removal that already completed on the server. Removing an
            active measurement again requires a separate deliberate action.
          </Notice>
          <Button
            title="Reload saved measurement and discard this removal"
            secondary
            busy={busy}
            onPress={() => {
              void discardConflictedRemoval();
            }}
          />
        </>
      )}
      {conflict && !pendingRemoval && (
        <>
          <Notice>
            The saved context changed elsewhere. Your draft is preserved. Current profile values:{" "}
            {profile.data?.profile?.weight_kg ?? "no weight"} kg / {profile.data?.profile?.height_cm ?? "no height"} cm.
            Reload the latest saved measurement and profile before trying again.
          </Notice>
          <Button
            title="Reload saved context and keep my draft"
            secondary
            busy={busy}
            onPress={() => {
              void reloadRevisions();
            }}
          />
        </>
      )}
    </Screen>
  );
}

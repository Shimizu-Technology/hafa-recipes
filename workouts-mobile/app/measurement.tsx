import { useEffect, useState } from "react";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { RecordedTime } from "@/components/recorded-time";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import {
  measurementErrors,
  measurementDisplay,
  type MeasurementKind,
  type MeasurementUnit,
  type MeasurementWrite,
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
  const { localDrafts, api, owner, enrollment, units } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const scope = `measurement:${id ?? kind}:${generation}`;
  const cache = useQueryClient();
  const profile = useQuery({
    queryKey: [owner, "measurement-profile", generation],
    queryFn: api.profileSnapshot,
    enabled: !!enrollment?.enrolled,
  });
  const entry = useQuery({
    queryKey: [owner, "measurement", id, generation],
    queryFn: () => api.measurement(id!, generation),
    enabled: !!id && !!enrollment?.enrolled,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    let active = true;
    setDraft(null);
    setRestored(false);
    void localDrafts
      .load<Draft>(owner, scope)
      .then((value) => {
        if (active) {
          if (value?.generation === generation) setDraft(value);
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
  }, [owner, scope, generation]);
  useEffect(() => {
    if (!restored || draft || !profile.data || (id && !entry.data)) return;
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
      measurement_revision: saved?.revision,
    });
  }, [restored, draft, profile.data, entry.data, id, kind, units, generation]);
  useEffect(() => {
    if (draft)
      void localDrafts
        .save(owner, scope, draft)
        .catch(() => setError("Could not keep this edit on the device. Retry before leaving."));
  }, [draft, owner, scope]);
  function update(patch: Partial<Draft>) {
    if (!busy && !draft?.operation && draft) setDraft({ ...draft, ...patch });
  }
  function unitChange(unit: MeasurementUnit) {
    if (!draft) return;
    const value = Number(draft.value);
    const oldCanonical = draft.unit === "lb" ? value * 0.45359237 : draft.unit === "in" ? value * 2.54 : value;
    const converted = unit === "lb" ? oldCanonical / 0.45359237 : unit === "in" ? oldCanonical / 2.54 : oldCanonical;
    update({
      unit,
      value: draft.value.trim() && Number.isFinite(converted) ? String(Number(converted.toFixed(6))) : draft.value,
    });
  }
  async function execute(operation: Operation) {
    if (!draft) return;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      await localDrafts.save(owner, scope, { ...draft, operation });
      setDraft({ ...draft, operation });
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
      await localDrafts.remove(owner, scope);
      cache.setQueryData([owner, "profile", generation], result.profile);
      await cache.invalidateQueries({ queryKey: [owner, "measurements"] });
      await cache.invalidateQueries({ queryKey: [owner, "measurement", id] });
      await cache.invalidateQueries({ queryKey: [owner, "measurement-profile"] });
      await cache.invalidateQueries({ queryKey: [owner, "program-proposals"] });
      setDraft(null);
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
      setBusy(false);
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
        update_current: draft.update_current,
      },
    });
  }
  async function remove() {
    if (!draft || !id || draft.measurement_revision == null) return;
    await execute({
      kind: "remove",
      profile_revision: draft.profile_revision,
      generation: draft.generation,
      body: { request_id: Crypto.randomUUID(), expected_revision: draft.measurement_revision },
    });
  }
  async function reloadRevisions() {
    if (!draft) return;
    setBusy(true);
    try {
      const [latestProfile, latestEntry] = await Promise.all([
        profile.refetch(),
        id ? entry.refetch() : Promise.resolve(null),
      ]);
      if (!latestProfile.data || (id && !latestEntry?.data))
        throw Error("Could not load current saved revisions. Your draft remains unchanged.");
      setDraft({
        ...draft,
        profile_revision: latestProfile.data.revision,
        measurement_revision: latestEntry?.data?.revision,
        operation: undefined,
      });
      setError("");
      setConflict(false);
      setMessage("Current saved revisions loaded. Review your draft against the current values before saving.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      title={id ? "Review your measurement." : `Record your ${kind}.`}
      subtitle="Original units, exact dates and deliberate profile updates."
    >
      {!!message && <Notice>{message}</Notice>}
      <QueryState
        loading={!restored || (!draft && (profile.isPending || (!!id && entry.isPending)))}
        error={profile.error ?? entry.error}
        retry={() => {
          void profile.refetch();
          if (id) void entry.refetch();
        }}
      >
        {entry.data?.status === "removed" ? (
          <Notice>This measurement was removed. Its value and recorded date have been cleared.</Notice>
        ) : (
          draft && (
            <>
              <Card>
                {entry.data && (
                  <Copy kind="small">
                    Currently saved · {measurementDisplay(entry.data)} ·{" "}
                    {entry.data.recorded_at ? new Date(entry.data.recorded_at).toLocaleString() : ""}
                  </Copy>
                )}
                <Field
                  label={draft.kind === "weight" ? "Measured weight" : "Measured height"}
                  numeric
                  value={draft.value}
                  onChange={(value) => update({ value })}
                />
                {(draft.kind === "weight" ? ["kg", "lb"] : ["cm", "in"]).map((unit) => (
                  <Choice
                    key={unit}
                    label={unit === "in" ? "inches" : unit}
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
                  title={draft.operation ? "Retry the same saved operation" : "Save measurement"}
                  busy={busy}
                  onPress={() => {
                    void save();
                  }}
                />
                {draft.operation && (
                  <Notice>
                    This operation keeps its original identity, generation and revisions through retry. Its fields are
                    locked while its saved outcome is uncertain.
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
      {!!error && <Notice error>{error}</Notice>}
      {conflict && (
        <>
          <Notice>
            The saved context changed elsewhere. Your draft is preserved. Current profile values:{" "}
            {profile.data?.profile?.weight_kg ?? "no weight"} kg / {profile.data?.profile?.height_cm ?? "no height"} cm.
            Reload the current entry and profile revisions deliberately before another save.
          </Notice>
          <Button
            title="Load current revisions for this draft"
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

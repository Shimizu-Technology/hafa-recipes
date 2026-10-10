import { AppState } from "react-native";
import { createActivityDraftStore } from "@/lib/activity-drafts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { CalendarDate } from "@/components/calendar-date";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import {
  activityLabels,
  activityErrors,
  activityBody,
  operationIsCurrent,
  type ActivityKind,
  type ActivityDraft,
  type ActivityOperation,
} from "@/lib/activity-log";
export default function ActivityEditor() {
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const id = params.id ?? null;
  const validId = !id || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  const { api, owner, enrollment, units, storage } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const scope = `activity-edit:${generation}:${id ?? "new"}`;
  const draftStore = useMemo(
    () => createActivityDraftStore(storage, owner, generation, id ?? "new"),
    [storage, owner, generation, id]
  );
  const cache = useQueryClient();
  const calendar = useQuery({
    queryKey: [owner, "activity-calendar", generation],
    queryFn: () => api.activityLog(generation),
    enabled: !!enrollment?.enrolled,
  });
  const entry = useQuery({
    queryKey: [owner, "activity", id, generation],
    queryFn: () => api.activity(id!, generation),
    enabled: validId && !!id && !!enrollment?.enrolled,
  });
  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [finished, setFinished] = useState(false);
  const lock = useRef(false);
  const focusKey = `${owner}:${scope}`;
  const current = useRef<string | null>(focusKey);
  current.current = focusKey;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, [])
  );
  useEffect(
    () => () => {
      current.current = null;
    },
    []
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && focused.current && enrollment?.enrolled) {
        void calendar.refetch();
        if (id && validId) void entry.refetch();
      }
    });
    return () => sub.remove();
  }, [calendar.refetch, entry.refetch, enrollment?.enrolled, id, validId]);
  function guard() {
    if (current.current !== focusKey || !focused.current || !storage.isCurrent())
      throw Error(
        "The account, enrollment or activity screen changed. This original request has not been moved to another draft."
      );
  }
  useEffect(() => {
    let active = true;
    setDraft(null);
    setRestored(false);
    setFinished(false);
    void draftStore
      .load()
      .then((box) => {
        if (active) {
          if (box.input?.owner === owner && box.input.generation === generation && box.input.target_id === id)
            setDraft({ ...box.input, operation: box.operation ?? undefined });
          setFinished(box.finished);
          if (box.finished)
            setMessage("This previous draft was resolved. Inspect saved history or start a new record deliberately.");
          setRestored(true);
        }
      })
      .catch(() => {
        if (active) {
          setRestored(true);
          setError("Could not restore the device draft. Saved activity is unchanged.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, scope, generation, id]);
  useEffect(() => {
    if (!restored || draft || finished || !calendar.data || (id && !entry.data)) return;
    const saved = entry.data;
    const content = saved?.content;
    const kind: ActivityKind =
      content?.kind ??
      (["run", "walk", "basketball", "other"].includes(params.kind ?? "") ? (params.kind as ActivityKind) : "other");
    setDraft({
      owner,
      generation,
      target_id: id,
      kind,
      date: content?.date ?? calendar.data.today,
      name: content?.name ?? "",
      duration: content?.duration_minutes == null ? "" : String(content.duration_minutes),
      distance:
        content?.distance_km == null
          ? ""
          : String(units === "imperial" ? content.distance_km / 1.609344 : content.distance_km),
      distance_unit: units === "imperial" ? "mi" : "km",
      notes: content?.notes ?? "",
      strenuous: content?.strenuous ?? null,
      expected_revision: saved?.revision,
      confirm_completed: saved?.completed_confirmed === true,
    });
  }, [restored, draft, finished, calendar.data, entry.data, id, params.kind, owner, generation]);
  useEffect(() => {
    if (draft && !finished)
      void draftStore.saveInput(draft).catch(() => setError("Could not preserve this draft. Retry before leaving."));
  }, [draft, owner, scope, finished]);
  useEffect(() => {
    if (id && entry.data && (entry.data.status === "removed" || entry.data.read_only)) {
      void draftStore
        .retire()
        .then(() => {
          if (current.current === focusKey) {
            setDraft(null);
            setFinished(true);
          }
        })
        .catch(() => {
          if (current.current === focusKey)
            setError("This entry is no longer editable. Device draft cleanup needs another attempt.");
        });
    }
  }, [id, entry.data, draftStore, focusKey]);
  function update(patch: Partial<ActivityDraft>) {
    if (!draft || busy || draft.operation || finished) return;
    setDraft({ ...draft, ...patch });
    setMessage("");
  }
  function changeUnit(unit: "mi" | "km") {
    if (!draft) return;
    const value = Number(draft.distance);
    const km = draft.distance_unit === "mi" ? value * 1.609344 : value;
    update({
      distance_unit: unit,
      distance:
        draft.distance.trim() && Number.isFinite(km)
          ? String(Number((unit === "mi" ? km / 1.609344 : km).toFixed(6)))
          : draft.distance,
    });
  }
  async function execute(operation: ActivityOperation) {
    if (lock.current || !draft) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      guard();
      if (!operationIsCurrent(operation, owner, generation, id, storage.isCurrent()))
        throw Error("The saved command belongs to another activity or enrollment.");
      const captured = { ...draft, operation };
      await draftStore.begin(captured, operation);
      guard();
      setDraft(captured);
      const result =
        operation.action === "remove"
          ? await api.removeActivity(
              id!,
              operation.body as { request_id: string; expected_revision: number },
              operation.generation
            )
          : await api.saveActivity(id, operation.body as ReturnType<typeof activityBody>, operation.generation);
      guard();
      await draftStore.complete(operation.body.request_id);
      guard();
      cache.setQueryData([owner, "activity", result.id, generation], result);
      await cache.invalidateQueries({ predicate: (q) => q.queryKey[0] === owner });
      guard();
      setDraft(null);
      setFinished(true);
      setConflict(false);
      setRemoveConfirm(false);
      setMessage(
        operation.action === "remove"
          ? "Activity removed from Håfa history. The old command cannot recreate it."
          : "Your completed activity is saved. Planning context was refreshed; no exercise sets were invented."
      );
    } catch (e) {
      if (current.current === focusKey && focused.current) {
        setError((e as Error).message);
        setConflict([409, 410].includes((e as { status?: number }).status ?? 0));
      }
    } finally {
      lock.current = false;
      if (current.current === focusKey) setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    if (draft.operation) {
      await execute(draft.operation);
      return;
    }
    const errors = activityErrors(draft, calendar.data?.today ?? "");
    if (id && !draft.expected_revision) errors.push("Reload the current activity before correcting it.");
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    await execute({
      owner,
      generation: draft.generation,
      target_id: id,
      action: "save",
      body: activityBody(draft, Crypto.randomUUID()),
    });
  }
  async function remove() {
    if (!draft || !id || !draft.expected_revision || !removeConfirm) return;
    await execute({
      owner,
      generation: draft.generation,
      target_id: id,
      action: "remove",
      body: { request_id: Crypto.randomUUID(), expected_revision: draft.expected_revision },
    });
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      guard();
      const fresh = id ? await api.activity(id, generation) : null;
      await calendar.refetch();
      guard();
      await draftStore.reset();
      guard();
      if (fresh) cache.setQueryData([owner, "activity", id, generation], fresh);
      setDraft(null);
      setFinished(false);
      setConflict(false);
      setError("");
      setMessage("Latest saved data loaded. The previous draft/command was deliberately discarded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      title={id ? "Review recorded activity." : "Log what you did."}
      subtitle="Runs, walks, basketball and other completed activity—without needing a library workout."
    >
      {!validId && <Notice error>This activity address is invalid.</Notice>}
      {!enrollment?.enrolled && <Button title="Set up Workouts" onPress={() => router.push("/onboarding")} />}
      <QueryState
        loading={!!enrollment?.enrolled && (calendar.isPending || (!!id && validId && entry.isPending))}
        error={calendar.error ?? entry.error}
        retry={() => {
          void calendar.refetch();
          if (id && validId) void entry.refetch();
        }}
      >
        {entry.data?.status === "removed" ? (
          <Notice>This activity has been removed. No old create/correction request can restore it.</Notice>
        ) : entry.data?.read_only ? (
          <Card>
            <Copy kind="heading">{entry.data.content?.name ?? "Imported activity"}</Copy>
            <Copy>
              {entry.data.content?.date} ·{" "}
              {entry.data.content?.duration_minutes == null
                ? "Duration not specified"
                : `${entry.data.content.duration_minutes} recorded minutes`}
            </Copy>
            <Notice>
              This imported activity is read only here. It is not a confirmed Håfa manual session and is excluded from
              manual training counts. Manage the originating record or its Health connection.
            </Notice>
            <Button title="Health connection controls" secondary onPress={() => router.push("/connections")} />
          </Card>
        ) : draft && !finished && validId ? (
          <>
            <Notice>
              Only record activity that already happened. Future basketball practices and other commitments belong in
              your profile’s schedule declarations. Logging here does not write a new record to the OS Health store.
            </Notice>
            {entry.data?.legacy && (
              <Notice>
                This older entry has not been confirmed as completed. Review its date, duration, type and demand before
                adopting it into completed history.
              </Notice>
            )}
            {Object.entries(activityLabels).map(([kind, label]) => (
              <Choice
                key={kind}
                label={label}
                selected={draft.kind === kind}
                disabled={busy || !!draft.operation}
                onPress={() =>
                  update({ kind: kind as ActivityKind, ...(!["run", "walk"].includes(kind) ? { distance: "" } : {}) })
                }
              />
            ))}
            <CalendarDate
              disabled={busy || !!draft.operation}
              label="Completed activity date"
              value={draft.date}
              onChange={(date) => update({ date: date ?? "" })}
            />
            <Copy kind="small">
              Training timezone · {calendar.data?.timezone}. Today · {calendar.data?.today}
            </Copy>
            <Field
              disabled={busy || !!draft.operation}
              label="Duration · whole minutes"
              numeric
              value={draft.duration}
              onChange={(duration) => update({ duration })}
            />
            <Field
              disabled={busy || !!draft.operation}
              label="Activity name"
              optional
              value={draft.name}
              onChange={(name) => update({ name })}
              placeholder={activityLabels[draft.kind]}
            />
            {["run", "walk"].includes(draft.kind) && (
              <>
                <Field
                  disabled={busy || !!draft.operation}
                  label={`Distance · ${draft.distance_unit === "mi" ? "miles" : "km"}`}
                  optional
                  numeric
                  value={draft.distance}
                  onChange={(distance) => update({ distance })}
                />
                <Choice
                  label="Kilometers"
                  selected={draft.distance_unit === "km"}
                  disabled={busy || !!draft.operation}
                  onPress={() => changeUnit("km")}
                />
                <Choice
                  label="Miles"
                  selected={draft.distance_unit === "mi"}
                  disabled={busy || !!draft.operation}
                  onPress={() => changeUnit("mi")}
                />
              </>
            )}
            <Copy kind="heading">How demanding was it?</Copy>
            {(
              [
                { value: null, label: "Not sure / prefer not to say" },
                { value: false, label: "Light / easy" },
                { value: true, label: "Strenuous" },
              ] as const
            ).map((choice) => (
              <Choice
                key={choice.label}
                label={choice.label}
                selected={draft.strenuous === choice.value}
                disabled={busy || !!draft.operation}
                onPress={() => update({ strenuous: choice.value })}
              />
            ))}
            <Field
              disabled={busy || !!draft.operation}
              label="Notes"
              optional
              multiline
              value={draft.notes}
              onChange={(notes) => update({ notes })}
            />
            <Choice
              label="I confirm this activity already happened"
              selected={draft.confirm_completed}
              disabled={busy || !!draft.operation}
              onPress={() => update({ confirm_completed: !draft.confirm_completed })}
            />
            {draft.operation && (
              <Notice>
                A durable {draft.operation.action === "remove" ? "removal" : "save"} is pending. Retry sends its exact
                original UUID, fields, owner, enrollment and revision. Inputs stay fixed until it is resolved or
                explicitly discarded.
              </Notice>
            )}
            <Button
              title={
                draft.operation
                  ? "Retry original activity command"
                  : entry.data?.legacy
                    ? "Confirm and adopt completed activity"
                    : id
                      ? "Save reviewed correction"
                      : "Save completed activity"
              }
              busy={busy}
              disabled={!!draft.operation && conflict}
              onPress={() => {
                void save();
              }}
            />
            {id && !draft.operation && (
              <>
                <Button
                  title="Review activity removal"
                  secondary
                  disabled={busy}
                  onPress={() => setRemoveConfirm(true)}
                />
                {removeConfirm && (
                  <Card>
                    <Notice>
                      Remove this Håfa activity entry and its private notes. Planning context and pending coach actions
                      are refreshed. Completed workout sessions and OS Health originals stay unchanged.
                    </Notice>
                    <Choice
                      label="I want to remove this activity entry"
                      selected={removeConfirm}
                      disabled={busy}
                      onPress={() => setRemoveConfirm(false)}
                    />
                    <Button
                      title="Confirm remove activity"
                      busy={busy}
                      onPress={() => {
                        void remove();
                      }}
                    />
                    <Button title="Keep activity" secondary disabled={busy} onPress={() => setRemoveConfirm(false)} />
                  </Card>
                )}
              </>
            )}
            {(conflict || draft.operation) && (
              <Button
                title="Reload current activity and discard this draft/command"
                secondary
                busy={busy}
                onPress={() => {
                  void reload();
                }}
              />
            )}
          </>
        ) : null}
      </QueryState>
      {!!message && <Notice>{message}</Notice>}
      {!!error && <Notice error>{error}</Notice>}
      {finished && id && entry.data?.content && (
        <Card>
          <Copy kind="heading">{entry.data.content.name}</Copy>
          <Copy>
            {entry.data.content.date} · saved revision {entry.data.revision}
          </Copy>
        </Card>
      )}
      {finished && entry.data?.status !== "removed" && !entry.data?.read_only && (
        <Button
          title={id ? "Review the current saved activity again" : "Start a new completed activity"}
          secondary
          busy={busy}
          onPress={() => {
            void reload();
          }}
        />
      )}
      {finished && <Button title="Open activity history" onPress={() => router.replace("/activity-log")} />}
      <Button title="Completed activity history" secondary onPress={() => router.push("/activity-log")} />
    </Screen>
  );
}

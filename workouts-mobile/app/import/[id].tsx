import { workoutErrors } from "@/lib/library";
import { SourceImage } from "@/components/source-image";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { AppState, Image, Linking } from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, ChipRow, Choice, Copy, Empty, ListRow, Notice, Screen, SectionHeader, Skeleton } from "@/components/ui";
import { WorkoutEditor } from "@/components/workout-editor";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { canSaveAutomatically, importIsTerminal, updateImportReferences, type CaptureDraft, type ImportReference } from "@/lib/capture";
import { cleanupCaptureFiles } from "@/lib/capture-io";
import * as Crypto from "expo-crypto";
import { createPrivateDraftSlot, type PrivateDraftSnapshot } from "@/lib/private-form";
import type { AuthoredWorkout } from "@/lib/models";
import { usePublishingDisclosure } from "@/components/publishing-disclosure";
import { DECLINED, INCOMPLETE_MESSAGE, defaultShareToDiscover, isIncomplete, publishable, prescriptionLine } from "@/lib/discover";
export default function ImportReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { localDrafts, api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation;
  const slot = useMemo(
    () => createPrivateDraftSlot<CaptureDraft>(storage, owner, `capture:${generation}`, Crypto.randomUUID),
    [storage, owner, generation]
  );
  const live = useRef({ owner, id, generation, storage, epoch: 0 });
  if (
    live.current.owner !== owner ||
    live.current.id !== id ||
    live.current.generation !== generation ||
    live.current.storage !== storage
  )
    live.current = { owner, id, generation, storage, epoch: live.current.epoch + 1 };
  const epoch = live.current.epoch;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function current() {
    if (!mounted.current || live.current.epoch !== epoch || !storage.isCurrent() || !isCurrentAccount())
      throw Error("This import or account changed. Open the current import before continuing.");
  }
  function isCurrent() {
    try {
      current();
      return true;
    } catch {
      return false;
    }
  }
  const cache = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [original, setOriginal] = useState<PrivateDraftSnapshot<CaptureDraft> | null>(null);
  const [edited, setEdited] = useState<AuthoredWorkout | null>(null);
  const [editing, setEditing] = useState(false);
  const [sourceDetails, setSourceDetails] = useState(false);
  const [restored, setRestored] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [autoAllowed, setAutoAllowed] = useState(false);
  const saving = useRef(false);
  const visibilityWrites = useRef<Promise<void>>(Promise.resolve());
  const autoAttempt = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** null = the default for this source (link imports public, everything else private). */
  const [shareChoice, setShareChoice] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const disclosure = usePublishingDisclosure();
  const [stateEpoch, setStateEpoch] = useState(epoch);
  const routeReady = stateEpoch === epoch;
  const originalSource =
    routeReady && original?.value?.job_id === id && original.value.generation === generation ? original.value : null;
  useFocusEffect(
    useCallback(() => {
      setVisible(true);
      return () => setVisible(false);
    }, [])
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  const q = useQuery({
    queryKey: [owner, "import", id, generation],
    queryFn: () => api.importJob(id),
    enabled: !!enrollment?.enrolled,
    refetchInterval: (query) =>
      visible && active && query.state.data && !importIsTerminal(query.state.data.status) ? 2500 : false
  });
  useEffect(() => {
    let valid = true;
    setStateEpoch(epoch);
    setOriginal(null);
    setEdited(null);
    setEditing(false);
    setSourceDetails(false);
    setRestored(false);
    setAutoAllowed(false);
    setBusy(false);
    setError("");
    setShareChoice(null);
    setNotice("");
    disclosure.dismiss();
    const sourceLoad = slot.load(current)
      .then((saved) => {
        if (valid && isCurrent() && saved.value?.job_id === id && saved.value.generation === generation)
          setOriginal(saved);
      })
      .catch((error) => {
        if (valid && isCurrent()) setError("Could not restore the original source for cleanup.");
        throw error;
      });
    const editLoad = localDrafts.load<AuthoredWorkout>(owner, `import-edit:${generation}:${id}`)
      .then((value) => {
        if (valid && isCurrent()) setEdited(value);
      })
      .catch((error) => {
        if (valid && isCurrent()) setError("Could not restore your corrections for this import.");
        throw error;
      });
    const visibilityLoad = localDrafts.load<boolean>(owner, `import-visibility:${generation}:${id}`).then((value) => {
      if (valid && isCurrent() && typeof value === "boolean") setShareChoice(value);
    });
    const referencesLoad = localDrafts.load<ImportReference[]>(owner, `imports:${generation}`).then((items) => {
      if (valid && isCurrent()) setAutoAllowed(items?.some((item) => item.id === id && item.auto_save === true &&
        (item.generation == null || item.generation === generation)) ?? false);
    });
    void Promise.all([sourceLoad, editLoad, visibilityLoad, referencesLoad]).then(() => {
      if (valid && isCurrent()) setRestored(true);
    }).catch(() => { if (valid && isCurrent()) setError("Could not restore this import’s saved choices. Try loading again before saving."); });
    return () => {
      valid = false;
    };
  }, [owner, id, generation, slot, epoch, restoreAttempt]);
  function update(value: AuthoredWorkout) {
    if (!routeReady || !isCurrent()) return;
    setEdited(value);
    void localDrafts.save(owner, `import-edit:${generation}:${id}`, value).catch(() => {
      if (isCurrent()) setError("Could not keep your corrections on this device. Stay here until saved.");
    });
  }
  function chooseVisibility(value: boolean, fromDisclosure = false) {
    if (saving.current && !fromDisclosure) return Promise.resolve();
    setShareChoice(value);
    const next = visibilityWrites.current.catch(() => undefined).then(async () => {
      current();
      await localDrafts.save(owner, `import-visibility:${generation}:${id}`, value);
      current();
    });
    visibilityWrites.current = next;
    return next;
  }
  async function retireOriginalSource() {
    current();
    if (!original?.value || original.value.job_id !== id || original.value.generation !== generation) return;
    const retained = [...(original.value.files ?? []), ...(original.value.cleanup_files ?? [])];
    let retirement: PrivateDraftSnapshot<CaptureDraft>;
    try {
      retirement = await slot.save(
        original.revision,
        {
          request_id: Crypto.randomUUID(),
          generation: original.value.generation,
          job_id: id,
          kind: "url",
          source_url: "",
          text: "",
          files: [],
          created_at: new Date().toISOString(),
          cleanup_files: retained
        },
        current
      );
    } catch (error) {
      // Another source owns this slot now; never clear or clean its assets.
      if ((error as { captureDraftConflict?: boolean }).captureDraftConflict) return;
      throw error;
    }
    current();
    setOriginal(retirement);
    // Keep exact old references durable until deletion succeeds. A newer source
    // can inherit them, so final removal is conditional on our retirement receipt.
    await cleanupCaptureFiles(retained, true);
    await slot.remove(retirement.revision, current);
  }
  async function accept(automatic = false) {
    if (saving.current || !routeReady || !restored || !isCurrent() || !q.data?.result?.workout) return;
    if (automatic && (edited || !canSaveAutomatically(q.data))) return;
    const errors = workoutErrors(edited ?? q.data.result.workout);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      current();
      await visibilityWrites.current;
      current();
      const content = edited ?? q.data.result.workout;
      const importGeneration = q.data.generation;
      let accepted = sharing
        ? await disclosure.run(() => {
            // The retry runs after the disclosure sheet; never send it for a changed import or account.
            current();
            return api.acceptImport(id, content, importGeneration, true, !automatic);
          })
        : await api.acceptImport(id, content, importGeneration, false, !automatic);
      current();
      if (accepted === DECLINED) {
        await chooseVisibility(false, true);
        current();
        accepted = await api.acceptImport(id, content, importGeneration, false, !automatic);
        current();
      }
      const saved = accepted;
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      current();
      cache.removeQueries({ queryKey: [owner, "import-source", id] });
      await localDrafts.remove(owner, `import-edit:${generation}:${id}`);
      current();
      await updateImportReferences(localDrafts, owner, importGeneration, current, (items) => items.filter((item) => item.id !== id));
      await retireOriginalSource();
      current();
      router.replace({ pathname: "/workout/[id]", params: { id: saved.id } });
    } catch (e) {
      if (isCurrent())
        setError(
          isIncomplete(e) && sharing && /discover|shar/i.test((e as { detail?: string }).detail ?? "")
            ? INCOMPLETE_MESSAGE
            : (e as Error).message
        );
    } finally {
      saving.current = false;
      if (isCurrent()) setBusy(false);
    }
  }
  async function cancel() {
    if (!routeReady || !isCurrent() || !q.data) return;
    setBusy(true);
    try {
      current();
      await api.cancelImport(id, q.data.generation);
      current();
      await retireOriginalSource();
      current();
      cache.removeQueries({ queryKey: [owner, "import-source", id] });
      await q.refetch();
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  const source = useQuery({
    queryKey: [owner, "import-source", id, generation],
    queryFn: () => api.importSource(id),
    enabled: !!q.data && ["ready", "incomplete", "failed"].includes(q.data.status) && !q.data.accepted_workout_id,
    staleTime: 60000
  });
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", generation],
    queryFn: api.capabilities,
    staleTime: 60000,
  });
  const result = q.data?.result;
  const workout = (routeReady ? edited : null) ?? result?.workout;
  const discoverOn = capabilities.data?.discover === true;
  // The server refuses to publish an incomplete extraction accepted unchanged.
  const shareable =
    !!workout && publishable(workout) && !(q.data?.status === "incomplete" && !(routeReady && edited));
  const wantsShare = shareChoice ?? defaultShareToDiscover(result?.workout?.capture_kind ?? originalSource?.kind);
  const sharing = discoverOn && shareable && wantsShare;
  useEffect(() => {
    if ((!autoAllowed && !originalSource?.auto_save) || !routeReady || !restored || !q.data || edited || editing ||
      error || !visible || !active || !capabilities.data || !canSaveAutomatically(q.data) || autoAttempt.current === epoch) return;
    autoAttempt.current = epoch;
    void accept(true);
  }, [autoAllowed, originalSource?.auto_save, routeReady, restored, q.data, edited, editing, error, visible, active, capabilities.data, epoch]);
  return (
    <Screen back title="Your workout." subtitle={busy ? "Saving your workout…" : "Check the exercises or make a quick edit."}>
      <QueryState
        loading={q.isPending}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {q.data && ["queued", "processing"].includes(q.data.status) && (
          <Card>
            <Copy kind="caption" tone="accent">{q.data.status === "queued" ? "Saved" : "Working on it"}</Copy>
            <Copy kind="heading">{q.data.status === "queued" ? "Your source is saved" : "Reading the source"}</Copy>
            <Skeleton height={14} width="85%" />
            <Skeleton height={14} width="60%" />
            <Copy tone="muted">You can leave this screen. The import continues in the background.</Copy>
            <Button title="Back to my library" secondary onPress={() => router.replace("/(tabs)/library")} />
          </Card>
        )}
        {!!q.data?.accepted_workout_id && (
          <Button
            title="Open saved workout"
            onPress={() => router.replace({ pathname: "/workout/[id]", params: { id: q.data!.accepted_workout_id! } })}
          />
        )}
        {q.data && ["failed", "expired", "cancelled"].includes(q.data.status) && (
          <Empty
            icon="document-text-outline"
            title={
              q.data.status === "expired"
                ? "This import expired"
                : q.data.status === "cancelled"
                  ? "Import cancelled"
                  : "Could not read this source"
            }
            description="You can paste clearer instructions, choose screenshots, or write the workout manually."
            action={<Button title="Write workout manually" secondary onPress={() => router.push("/add-workout")} />}
          />
        )}
        {result && (
          <>
            {result.warnings.map((warning, index) => (
              <Notice key={index} tone="warning">{warning}</Notice>
            ))}
            {result.source.coverage_notes.map((note, index) => (
              <Notice key={`coverage-${index}`}>{note}</Notice>
            ))}
            {workout && (
              <>
                {routeReady && editing ? (
                  <WorkoutEditor value={workout} onChange={update} disabled={busy} />
                ) : (
                  <>
                    <SectionHeader title={workout.title} />
                    <ChipRow wrap>
                      {workout.equipment_required?.length ? (
                        workout.equipment_required.map((item) => <Chip key={item} label={item} icon="barbell-outline" />)
                      ) : (
                        <Chip label="Equipment not specified" tone="accent" />
                      )}
                    </ChipRow>
                    {workout.blocks.map((block) => (
                      <Card key={block.id}>
                        <Copy kind="subheading">{block.label}</Copy>
                        <Copy kind="small" tone={block.rounds == null ? "accent" : "muted"}>
                          {block.grouping} · {block.rounds == null ? "Rounds not specified" : `${block.rounds} rounds`}
                        </Copy>
                        {block.exercises.map((e, index) => (
                          <Copy key={index}>
                            <Copy kind="label">{e.name}</Copy>
                            {" · "}
                            <Copy>{prescriptionLine(e)}</Copy>
                          </Copy>
                        ))}
                      </Card>
                    ))}
                  </>
                )}
                <Button
                  title={routeReady && editing ? "Show workout summary" : "Correct workout details"}
                  secondary
                  icon={routeReady && editing ? "eye-outline" : "create-outline"}
                  disabled={busy || !restored}
                  onPress={() => {
                    if (routeReady && isCurrent()) setEditing(!editing);
                  }}
                />
                {discoverOn && (
                  <Choice
                    icon="globe-outline"
                    label="Share to Discover"
                    detail={
                      shareable
                        ? "Anyone using Håfa Workouts can find and save this workout, credited to the original creator. Your notes and training stay private."
                        : INCOMPLETE_MESSAGE
                    }
                    selected={sharing}
                    disabled={!shareable || busy}
                    onPress={() => {
                      if (routeReady && isCurrent()) void chooseVisibility(!sharing).catch(() => {
                        if (isCurrent()) setError("Could not save your sharing choice. Try choosing it again before saving.");
                      });
                    }}
                  />
                )}
                {q.data?.status === "incomplete" && <Notice tone="warning">
                  Some details were not in the source. You can edit them or save this workout with the gaps clearly marked.
                </Notice>}
                {!!notice && <Notice>{notice}</Notice>}
                <Button
                  title={sharing ? "Save and share to Discover" : "Save workout"}
                  icon={sharing ? "globe-outline" : "lock-closed-outline"}
                  size="lg"
                  busy={busy}
                  disabled={!routeReady || !restored || busy || !!q.data?.accepted_workout_id}
                  onPress={() => {
                    void accept();
                  }}
                />
              </>
            )}
            <Button title={sourceDetails ? "Hide source details" : "Source details"} variant="ghost" onPress={() => setSourceDetails(!sourceDetails)} />
            {sourceDetails && <>
            <Card>
              <Copy kind="caption" tone="accent">Source</Copy>
              <Copy kind="heading">{result.source.title ?? "Original source"}</Copy>
              {!!result.source.creator && <Copy tone="muted">By {result.source.creator}</Copy>}
              <ChipRow wrap>
                <Chip label={result.source.platform} icon="globe-outline" />
                {result.source.channels.length ? (
                  result.source.channels.map((channel) => <Chip key={channel} label={channel} />)
                ) : (
                  <Chip label="No source channels available" />
                )}
              </ChipRow>
              {!!result.source.url && (
                <ListRow
                  icon="open-outline"
                  title="Open source"
                  trailing="external"
                  onPress={() => {
                    void Linking.openURL(result.source.url!).catch(() => setError("Could not open the source."));
                  }}
                />
              )}
              {originalSource?.kind === "text" && <Copy>{originalSource.text}</Copy>}
              {!source.data?.images?.length &&
                originalSource?.files
                  .filter((f) => f.mime_type.startsWith("image/"))
                  .map((file) => (
                    <SourceImage key={file.uri} uri={file.uri} label={`Original source image: ${file.name}`} />
                  ))}
              {source.data?.images?.map((image, index) => (
                <SourceImage
                  key={index}
                  uri={`data:${image.mime_type};base64,${image.base64_data}`}
                  label={`Original source image ${index + 1}`}
                />
              ))}
              {!!(!originalSource?.text && source.data?.text) && <Copy>{source.data.text}</Copy>}
              {source.error && (
                <Notice error>
                  The original upload is no longer available here. Check the source yourself before accepting this
                  draft.
                </Notice>
              )}
            </Card>
            {!!result.evidence.length && (
              <Card tone="sunken">
                <Copy kind="subheading">What the source supports</Copy>
                {result.evidence.map((e, index) => (
                  <Copy key={index} kind="small">
                    {e.field} · {e.wording}
                    {e.location ? ` (${e.location})` : ""}
                  </Copy>
                ))}
              </Card>
            )}
            </>}
          </>
        )}
        {q.data && !["cancelled", "expired"].includes(q.data.status) && !q.data.accepted_workout_id && (
          <Button
            title="Cancel import and clear source upload"
            variant="destructive"
            busy={busy}
            onPress={() => {
              void cancel();
            }}
          />
        )}
      </QueryState>
      {!!error && <Notice error>{error}</Notice>}
      {!restored && !!error && <Button title="Try loading again" secondary disabled={busy} onPress={() => {
        setError(""); setRestoreAttempt((value) => value + 1); void q.refetch();
      }} />}
      <Notice>
        Uploaded photos and documents are temporary: they are cleared after acceptance, cancellation or expiry. Your
        library keeps the prescription, evidence and source link where available. An incomplete private draft may stay
        incomplete.
      </Notice>
      {disclosure.sheet}
    </Screen>
  );
}

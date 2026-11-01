import { workoutErrors } from "@/lib/library";
import { SourceImage } from "@/components/source-image";
import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from "react";
import { ActivityIndicator, AppState, Image, Linking } from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, ChipRow, Choice, Copy, Empty, Field, ListRow, Notice, Screen, SectionHeader, Skeleton } from "@/components/ui";
import { WorkoutInstructions } from "@/components/workout-instructions";
import { WorkoutEditor } from "@/components/workout-editor";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { canSaveAutomatically, importIsTerminal, updateImportReferences, loadCapturedImport, retireCapturedImport, type CaptureDraft, type ImportReference } from "@/lib/capture";
import { cleanupCaptureFiles, sourceFor } from "@/lib/capture-io";
import { recoverySource } from "@/lib/import-recovery";
import type { ExtractionRequest, ImportJob } from "@/lib/capture";
import * as Crypto from "expo-crypto";
import { type PrivateDraftSnapshot } from "@/lib/private-form";
import type { AuthoredWorkout } from "@/lib/models";
import { usePublishingDisclosure } from "@/components/publishing-disclosure";
import { DECLINED, INCOMPLETE_MESSAGE, defaultShareToDiscover, isIncomplete, publishable, prescriptionLine, formatSeconds } from "@/lib/discover";
import { WorkoutSource } from "@/components/workout-source";
import { ImportProgress } from "@/components/import-progress";
import { amrapCap, blockSummary, timedBlock } from "@/lib/amrap-editor";
export default function ImportReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { localDrafts, api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation;
  const epoch = useMemo(() => ({}), [owner, id, generation, storage]);
  const live = useRef(epoch);
  useLayoutEffect(() => { live.current = epoch; }, [epoch]);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function current() {
    if (!mounted.current || live.current !== epoch || !storage.isCurrent() || !isCurrentAccount())
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
  const autoAttempt = useRef<object | null>(null);
  const reconciledSave = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attemptedUpdate, setAttemptedUpdate] = useState<boolean | null>(null);
  const [updateConflict, setUpdateConflict] = useState(false);
  /** null = the default for this source (link imports public, everything else private). */
  const [shareChoice, setShareChoice] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const [caption, setCaption] = useState("");
  const captionWrites = useRef<Promise<void>>(Promise.resolve());
  const [retryCommand, setRetryCommand] = useState<{ request_id: string; source: ExtractionRequest; auto_save: boolean; saved_id?: string; replace_target?: ImportJob["replace_target"] } | null>(null);
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
  useLayoutEffect(() => {
    let valid = true;
    saving.current = false;
    setStateEpoch(epoch);
    setOriginal(null);
    setEdited(null);
    setEditing(false);
    setSourceDetails(false);
    setRestored(false);
    setAutoAllowed(false);
    setBusy(false);
    setError("");
    setAttemptedUpdate(null);
    setUpdateConflict(false);
    setShareChoice(null);
    setNotice("");
    setCaption("");
    setRetryCommand(null);
    disclosure.dismiss();
    const sourceLoad = loadCapturedImport(storage, owner, generation!, id, current, Crypto.randomUUID)
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
    const visibilityLoad = localDrafts.load<boolean>(owner, `import-visibility:${generation}:${id}`).then(async (chosen) => {
      const value = typeof chosen === "boolean" ? chosen : await localDrafts.load<boolean>(owner, `import-source-visibility:${generation}:${id}`);
      if (valid && isCurrent() && typeof value === "boolean") setShareChoice(value);
    });
    const referencesLoad = localDrafts.load<ImportReference[]>(owner, `imports:${generation}`).then((items) => {
      if (valid && isCurrent()) setAutoAllowed(items?.some((item) => item.id === id && item.auto_save === true &&
        (item.generation == null || item.generation === generation)) ?? false);
    });
    const retryLoad = localDrafts.load<NonNullable<typeof retryCommand>>(owner, `import-retry:${generation}:${id}`).then(value => {
      if (valid && isCurrent()) setRetryCommand(value);
    });
    const captionLoad = localDrafts.load<string>(owner, `import-retry-caption:${generation}:${id}`).then(value => {
      if (valid && isCurrent()) setCaption(value ?? "");
    });
    void Promise.all([sourceLoad, editLoad, visibilityLoad, referencesLoad, retryLoad, captionLoad]).then(() => {
      if (valid && isCurrent()) setRestored(true);
    }).catch(() => { if (valid && isCurrent()) setError("Could not restore this import’s saved choices. Try loading again before saving."); });
    return () => {
      valid = false;
    };
  }, [owner, id, generation, storage, epoch, restoreAttempt]);
  function update(value: AuthoredWorkout) {
    if (!routeReady || !isCurrent()) return;
    setEdited(value);
    void localDrafts.save(owner, `import-edit:${generation}:${id}`, value).catch(() => {
      if (isCurrent()) setError("Could not keep your corrections on this device. Stay here until saved.");
    });
  }
  function chooseVisibility(value: boolean, fromDisclosure = false) {
    if (!routeReady || !restored || !isCurrent()) return Promise.resolve();
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
    await retireCapturedImport(storage, owner, generation!, id, current, cleanupCaptureFiles, Crypto.randomUUID);
    current();
    setOriginal(null);
  }
  async function accept(automatic = false, updateExisting = false) {
    if (saving.current || !routeReady || !restored || !isCurrent() || !q.data?.result?.workout) return;
    if (automatic && (edited || !canSaveAutomatically(q.data))) return;
    setUpdateConflict(false);
    const content = edited ?? q.data.result.workout;
    const errors = content.blocks.some(block => block.exercises.length)
      ? workoutErrors(content, q.data.status === "incomplete" && !sharing)
      : ["Add at least one exercise before saving this workout."];
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    saving.current = true;
    setAttemptedUpdate(updateExisting);
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
        : updateExisting
          ? await api.acceptImport(id, content, importGeneration, false, !automatic, true)
          : await api.acceptImport(id, content, importGeneration, false, !automatic);
      current();
      if (accepted === DECLINED) {
        await chooseVisibility(false, true);
        current();
        accepted = await api.acceptImport(id, content, importGeneration, false, !automatic);
        current();
      }
      const saved = accepted;
      if (updateExisting) {
        cache.setQueryData([owner, "workout", saved.id, generation], saved);
        void cache.invalidateQueries({ queryKey: [owner, "workout-versions", saved.id] });
        void cache.invalidateQueries({ queryKey: [owner, "discover"] });
      }
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
      if (isCurrent()) {
        const conflict = updateExisting && (e as { status?: number }).status === 409 &&
          (e as { detail?: string }).detail === "Workout changed; save a separate copy or extract again from its latest version";
        setUpdateConflict(conflict);
        setError(
          isIncomplete(e) && sharing && /discover|shar/i.test((e as { detail?: string }).detail ?? "")
            ? INCOMPLETE_MESSAGE
            : conflict
              ? "Your saved workout changed while you reviewed this import. Its newer edit is safe. You can keep this import as a separate private workout."
              : (e as Error).message
        );
      }
    } finally {
      if (isCurrent()) { saving.current = false; setBusy(false); }
    }
  }
  async function retryExtraction() {
    if (saving.current || !routeReady || !restored || !isCurrent() || !q.data) return;
    saving.current = true; setBusy(true); setError("");
    try {
      current();
      if (retryCommand?.saved_id) {
        router.replace({ pathname: "/import/[id]", params: { id: retryCommand.saved_id } });
        return;
      }
      if (!capabilities.data) return;
      await captionWrites.current.catch(() => undefined); current();
      const consent = await api.aiConsent(); current();
      if (!consent.accepted || consent.disclosure_version !== 1) throw Error("Review AI preferences in Settings before retrying this source.");
      let command = retryCommand;
      if (!command) {
        let retained: ExtractionRequest | null = null;
        try { retained = await api.importSource(id); current(); }
        catch (e) {
          current();
          if (![404, 410].includes((e as { status?: number }).status ?? 0)) throw e;
          if (originalSource) retained = await sourceFor(originalSource, current);
        }
        current();
        command = { request_id: Crypto.randomUUID(),
          source: recoverySource(retained, q.data.result?.source.url ?? q.data.result?.workout?.source_url, caption),
          auto_save: q.data.replace_target ? false : capabilities.data.server_auto_save === true,
          ...(q.data.replace_target ? { replace_target: q.data.replace_target } : {}) };
        await localDrafts.save(owner, `import-retry:${generation}:${id}`, command); current();
        setRetryCommand(command);
      }
      const next = await api.startImport(command.request_id, command.source, q.data.generation,
        { auto_save: command.auto_save, is_public: false, ...(command.replace_target ? { replace_target: command.replace_target } : {}) }); current();
      command = { ...command, saved_id: next.id };
      await localDrafts.save(owner, `import-retry:${generation}:${id}`, command); current();
      setRetryCommand(command);
      await localDrafts.save(owner, `import-visibility:${generation}:${next.id}`, false); current();
      await updateImportReferences(localDrafts, owner, q.data.generation, current, items => [
        { id: next.id, generation: next.generation, label: command!.source.source_url ?? "Workout from source text", auto_save: command!.auto_save },
        ...items.filter(item => item.id !== next.id) ]); current();
      await cache.invalidateQueries({ queryKey: [owner, "imports"] }); current();
      await localDrafts.remove(owner, `import-retry-caption:${generation}:${id}`); current();
      router.replace({ pathname: "/import/[id]", params: { id: next.id } });
    } catch (e) { if (isCurrent()) setError((e as Error).message); }
    finally { if (isCurrent()) { saving.current = false; setBusy(false); } }
  }
  async function cancel(dismiss = false) {
    const absent = [404, 410].includes((q.error as { status?: number } | null)?.status ?? 0);
    if (saving.current || !routeReady || !isCurrent() || !generation || (!q.data && !(dismiss && absent))) return;
    saving.current = true;
    setBusy(true);
    try {
      current();
      if (!absent) await api.cancelImport(id, q.data!.generation);
      current();
      await retireOriginalSource();
      current();
      await updateImportReferences(localDrafts, owner, generation, current, items => items.filter(item => item.id !== id));
      current();
      await localDrafts.remove(owner, `import-retry:${generation}:${id}`);
      current();
      await captionWrites.current.catch(() => undefined); current();
      await localDrafts.remove(owner, `import-retry-caption:${generation}:${id}`); current();
      cache.removeQueries({ queryKey: [owner, "import-source", id] });
      await cache.invalidateQueries({ queryKey: [owner, "imports"] });
      await q.refetch();
      if (dismiss) { current(); router.replace("/extract"); }
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    } finally {
      if (isCurrent()) { saving.current = false; setBusy(false); }
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
  const hasExercises = !!workout?.blocks.some(block => block.exercises.length);
  const savedId = q.data?.accepted_workout_id;
  const reviewAction = savedId
    ? "Open the saved workout to check or edit those details."
    : "Check the source or edit the details before saving.";
  const usageLimitReached = result?.error_code === "workouts_ai_budget_exceeded";
  const reviewMessage = usageLimitReached
    ? savedId
      ? `AI importing is temporarily paused. Your workout is saved. ${reviewAction}`
      : "AI importing is temporarily paused. Your source stays saved. Try again later, or add the exercises manually."
    : !!result?.error_code
      ? savedId
        ? `We couldn’t finish checking this source. Your workout is saved. ${reviewAction}`
        : "We couldn’t finish checking this source. Your source stays saved. Try again later, or add the exercises manually."
      : q.data?.status === "incomplete"
        ? hasExercises ? `We couldn’t confirm all workout details. ${reviewAction}` : "No exercises were imported. Check the source, retry with instructions, or add exercises manually."
        : result?.warnings.length
          ? `Some workout details may need checking. ${reviewAction}`
          : null;
  const diagnostics = [...new Set([...(result?.warnings ?? []), ...(result?.source.coverage_notes ?? [])])];
  const discoverOn = capabilities.data?.discover === true;
  // The server refuses to publish an incomplete extraction accepted unchanged.
  const shareable =
    !!workout && publishable(workout) && !(q.data?.status === "incomplete" && !(routeReady && edited));
  const wantsShare = shareChoice ?? originalSource?.is_public ?? q.data?.source_is_public ?? defaultShareToDiscover(result?.workout?.capture_kind ?? originalSource?.kind);
  const sharing = !q.data?.replace_target && discoverOn && shareable && wantsShare;
  useEffect(() => {
    if ((!autoAllowed && !originalSource?.auto_save) || !routeReady || !restored || !q.data || edited || editing ||
      error || !visible || !active || !capabilities.data || capabilities.data.server_auto_save || !canSaveAutomatically(q.data) || autoAttempt.current === epoch) return;
    autoAttempt.current = epoch;
    void accept(true);
  }, [autoAllowed, originalSource?.auto_save, routeReady, restored, q.data, edited, editing, error, visible, active, capabilities.data, epoch]);
  useEffect(() => {
    if (!q.data?.accepted_workout_id || !routeReady || !restored || reconciledSave.current === epoch) return;
    reconciledSave.current = epoch;
    void (async () => {
      current(); await cache.invalidateQueries({ queryKey: [owner, "library"] }); current();
      await updateImportReferences(localDrafts, owner, q.data!.generation, current, prior => prior.filter(item => item.id !== id));
      await retireOriginalSource(); current();
    })().catch(() => {
      reconciledSave.current = null;
      if (isCurrent()) setError("Your workout is saved. Try loading again to finish clearing its temporary source.");
    });
  }, [q.data?.accepted_workout_id, routeReady, restored, epoch, id]);
  const savedDraft = savedId && q.data?.status === "incomplete";
  return (
    <Screen back title={savedDraft ? "Draft saved" : savedId ? "Workout saved" : "Workout"}
      subtitle={savedDraft ? "Saved privately in your library. Review the workout before training." : savedId ? "Ready in your library. Check or edit the details whenever you need." : busy ? "Saving your workout…" : q.data && ["queued", "processing"].includes(q.data.status) ? "Reading your source. You can leave and check back in Add." : "Check the result and choose your next step."}
      footer={!!error && <>
        <Notice error>{error}</Notice>
        {q.data?.replace_target && attemptedUpdate !== null && hasExercises && !editing && !savedId && <Button
          title={updateConflict ? "Save as a separate private workout" : attemptedUpdate ? "Retry updating saved workout" : "Retry saving private workout"}
          secondary busy={busy} disabled={!routeReady || !restored}
          onPress={() => { void accept(false, !updateConflict && attemptedUpdate); }} />}
        {!restored && <Button title="Try loading again" secondary disabled={busy} onPress={() => {
          setError(""); setRestoreAttempt((value) => value + 1); void q.refetch();
        }} />}
      </>}>
      <QueryState hasData={q.data !== undefined}
        loading={q.isPending}
        error={q.data && ["queued", "processing"].includes(q.data.status) ? null : q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {q.data && ["queued", "processing"].includes(q.data.status) && (
          <ImportProgress job={q.data} autoSave={capabilities.data?.server_auto_save} connectionError={q.error} refreshing={q.isFetching} active={visible && active}
            refresh={() => { void q.refetch(); }} openLibrary={() => router.replace("/(tabs)/library")} />
        )}
        {!!q.data?.accepted_workout_id && (
          <>
          <Button
            title="Open saved workout"
            onPress={() => router.replace({ pathname: "/workout/[id]", params: { id: q.data!.accepted_workout_id! } })}
          />
          <Button title="Check details" secondary onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id: savedId!, review: "1" } })} />
          </>
        )}
        {q.data && (["failed", "expired", "cancelled"].includes(q.data.status) || (q.data.status === "incomplete" && !workout)) && (
          <Empty
            icon="document-text-outline"
            title={
              q.data.status === "expired"
                ? "This import expired"
                : q.data.status === "cancelled"
                  ? "Import cancelled"
                  : usageLimitReached ? "AI importing temporarily paused" : result?.error_code ? "Processing did not finish" : "No workout imported"
            }
            description={q.data.status === "cancelled"
              ? "This import was cleared and its source is no longer available here. Your library shows the workouts you’ve kept."
              : q.data.status === "expired"
                ? "This temporary source expired. Any workout you saved remains in your library."
                : result?.error_code ? "Your source is still available for retry. Try again later or add the exercises manually." : "We couldn’t read a usable workout from this source. Try clearer instructions or screenshots, or write it yourself."}
            action={<><Button title="Try another source" secondary onPress={() => router.push("/capture")} />
              <Button title="Write workout manually" secondary onPress={() => router.push("/add-workout")} /></>}
          />
        )}
        {result && (
          <>
            {!hasExercises && reviewMessage && <Notice tone="warning">{reviewMessage}</Notice>}
            {workout && (
              <>
                {routeReady && editing && !savedId ? (
                  <WorkoutEditor value={workout} onChange={update} disabled={busy} />
                ) : (
                  <>
                    <SectionHeader title={hasExercises ? workout.title : "No exercises were imported"} />
                    <WorkoutInstructions instructions={workout.instructions} notes={workout.notes} />
                    {hasExercises && <ChipRow wrap>
                      {workout.equipment_required?.length ? (
                        workout.equipment_required.map((item) => <Chip key={item} label={item} icon="barbell-outline" />)
                      ) : (
                        <Chip label="Equipment not specified" tone="accent" />
                      )}
                    </ChipRow>}
                    {workout.blocks.map((block) => (
                      <Card key={block.id}>
                        <Copy kind="subheading">{block.label}</Copy>
                        <Copy kind="small" tone={block.rounds == null ? "accent" : "muted"}>
                          {blockSummary(block, block.label)}{block.rounds == null && block.grouping !== "sequential" && !timedBlock(block) ? " · Rounds not specified" : ""}
                          {block.rest_between_rounds_seconds != null ? ` · ${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : ""}
                        </Copy>
                        {block.exercises.map((e, index) => (
                          <Copy key={index}>
                            <Copy kind="label">{e.name}</Copy>
                            {" · "}
                            <Copy>{prescriptionLine(e)}</Copy>
                            {e.instructions ? <Copy kind="small">{"\n"}{e.instructions}</Copy> : null}
                      {e.notes ? <Copy kind="small">{"\n"}Private note · {e.notes}</Copy> : null}
                          </Copy>
                        ))}
                      </Card>
                    ))}
                  </>
                )}
                <WorkoutSource source={{ source_title: workout.source_title ?? result.source.title,
                  source_creator: workout.source_creator ?? result.source.creator, source_thumbnail_url: workout.source_thumbnail_url, source_context: workout.source_context }} />
                {hasExercises && reviewMessage && <Notice tone="warning">{reviewMessage}</Notice>}
                {!savedId && <><Button
                  title={routeReady && editing ? "Show workout summary" : hasExercises ? "Correct workout details" : "Add exercises manually"}
                  secondary
                  icon={routeReady && editing ? "eye-outline" : "create-outline"}
                  disabled={busy || !restored}
                  onPress={() => {
                    if (routeReady && isCurrent()) setEditing(!editing);
                  }}
                />
                {discoverOn && hasExercises && !q.data?.replace_target && (
                  <Choice
                    icon="globe-outline"
                    label="Share to Discover"
                    detail={
                      shareable
                        ? "Anyone using Håfa Workouts can find and save this workout, credited to the original creator. Your notes and training stay private."
                        : INCOMPLETE_MESSAGE
                    }
                    selected={sharing}
                    disabled={!routeReady || !restored || !shareable || busy}
                    onPress={() => {
                      if (routeReady && isCurrent()) void chooseVisibility(!sharing).catch(() => {
                        if (isCurrent()) setError("Could not save your sharing choice. Try choosing it again before saving.");
                      });
                    }}
                  />
                )}
                {!!notice && <Notice>{notice}</Notice>}
                {hasExercises && <Button
                  title={q.data?.replace_target ? "Update saved workout" : sharing ? "Save and share to Discover" : "Save workout"}
                  icon={sharing ? "globe-outline" : "lock-closed-outline"}
                  size="lg"
                  busy={busy}
                  disabled={!routeReady || !restored || busy || !!q.data?.accepted_workout_id}
                  onPress={() => {
                    void accept(false, !!q.data?.replace_target);
                  }}
                />}
                {hasExercises && q.data?.replace_target && <>
                  <Copy kind="small">Updating creates a new version. Your private notes, organization and recorded sessions stay saved. This replaces version {q.data.replace_target.expected_revision}; a newer edit will be protected. If already shared to Discover, its public instructions will update there.</Copy>
                  {!error && <Button title="Save as a separate private workout" secondary busy={busy} disabled={!routeReady || !restored || !!savedId} onPress={() => { void accept(); }} />}
                </>}</>}
              </>
            )}
            <Button title={sourceDetails ? "Hide source details" : "Source details"} variant="ghost" onPress={() => setSourceDetails(!sourceDetails)} />
            {sourceDetails && <>
            {(diagnostics.length > 0 || result.error_code) && <Card tone="sunken">
              <Copy kind="subheading">Import diagnostics</Copy>
              {!!result.error_code && <Copy kind="small">Import status · {result.error_code}</Copy>}
              {diagnostics.map((diagnostic, index) => <Copy key={index} kind="small">{diagnostic}</Copy>)}
            </Card>}
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
        {q.data && ["incomplete", "failed", "expired"].includes(q.data.status) && <Card compact>
          <Copy kind="heading">Try reading the source again</Copy>
          <Copy kind="small">Paste the creator’s caption or instructions if the video could not be read. This creates a separate private import. Your saved workouts stay unchanged.</Copy>
          <Field label="Caption or source instructions" multiline optional value={caption} onChange={value => {
            if (!routeReady || !restored || saving.current || retryCommand || !isCurrent()) return;
            setCaption(value);
            const next = captionWrites.current.catch(() => undefined).then(async () => {
              current(); await localDrafts.save(owner, `import-retry-caption:${generation}:${id}`, value); current();
            });
            captionWrites.current = next;
            void next.catch(() => { if (isCurrent()) setError("Could not keep this caption on your device. Stay here until the retry is saved."); });
          }} disabled={!restored || busy || !!retryCommand} />
          {!!retryCommand && <Copy kind="small">{retryCommand.saved_id ? "This retry is already saved. Open its import to continue." : "Retrying the same saved request. Its source and caption stay unchanged until the request is recovered."}</Copy>}
          <Button title={retryCommand?.saved_id ? "Open retry import" : retryCommand ? "Reconnect retry" : caption.trim() ? "Retry with this caption" : "Retry this source"} secondary busy={busy}
            disabled={!restored || !routeReady || (!retryCommand?.saved_id && !capabilities.data?.imports)} onPress={() => { void retryExtraction(); }} />
        </Card>}
        {q.data && importIsTerminal(q.data.status) && <>
          <Copy kind="small" tone="muted">Dismiss clears this import and its temporary source. Saved workouts stay in your library.</Copy>
          <Button title="Dismiss import" variant="ghost" busy={busy} onPress={() => { void cancel(true); }} />
        </>}
        {q.data && !importIsTerminal(q.data.status) && !q.data.accepted_workout_id && (
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
      {[404, 410].includes((q.error as { status?: number } | null)?.status ?? 0) && <Button title="Dismiss import" variant="ghost" busy={busy}
        onPress={() => { void cancel(true); }} />}
      <Notice>
        Uploads are cleared after saving, cancellation or expiry. Saved workouts keep the workout details and source
        link when available.
      </Notice>
      {disclosure.sheet}
    </Screen>
  );
}

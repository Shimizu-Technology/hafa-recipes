import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Copy,
  Empty,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  SectionHeader,
  Sheet,
  Stack,
  Row,
  useToast,
} from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { usePublishingDisclosure } from "@/components/publishing-disclosure";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { DECLINED, INCOMPLETE_MESSAGE, discoverKeys, isIncomplete, prescriptionLine, formatSeconds } from "@/lib/discover";
import type { Workout } from "@/lib/models";
import { trackingPrescriptionWarning, type StartChoice } from "@/lib/training";
import { WorkoutStartSheet } from "@/components/workout-start-sheet";
import { WorkoutInstructions } from "@/components/workout-instructions";
import { WorkoutFavorite } from "@/components/workout-favorite";
import { SavedSourceText } from "@/components/workout-source";
import { WorkoutHero } from "@/components/workout-hero";
import { workoutOriginDescription } from "@/lib/workout-presentation";
import { workoutMeta } from "@/lib/plan-presentation";
import { amrapCap, blockSummary } from "@/lib/amrap-editor";
import { workoutDeletionBlock } from "@/lib/organization";
export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner, enrollment, isCurrentAccount } = useTraining();
  const mounted = useRef(true);
  const action = useRef<"start" | "delete" | null>(null);
  const scope = `${owner}:${enrollment?.generation}:${id}`;
  const liveScope = useRef(scope);
  useLayoutEffect(() => { liveScope.current = scope; }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const q = useQuery({
    queryKey: [owner, "workout", id, enrollment?.generation],
    queryFn: () => api.workout(id),
    enabled: !!enrollment?.enrolled,
  });
  const workout = q.data;
  const offline = useOfflineTraining();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ scope: string; text: string } | null>(null);
  const [diagnosticScope, setDiagnosticScope] = useState<string | null>(null);
  const cache = useQueryClient();
  const toast = useToast();
  const disclosure = usePublishingDisclosure();
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", enrollment?.generation],
    queryFn: api.capabilities,
    staleTime: 60000,
  });
  const discoverOn = capabilities.data?.discover === true;
  const deleteBlock = workout ? workoutDeletionBlock(workout.id, offline.state, offline.ready) : null;
  async function remove() {
    if (!workout || action.current || !isCurrentAccount()) return;
    const blocked = workoutDeletionBlock(workout.id, offline.store?.snapshot() ?? offline.state, offline.ready);
    if (blocked) { setError(blocked); return; }
    action.current = "delete";
    setDeleteBusy(true);
    setError("");
    try {
      await api.deleteWorkout(workout.id, workout.generation);
      if (!isCurrentAccount()) return;
      cache.removeQueries({ queryKey: [owner, "workout", id] });
      await Promise.all([
        cache.invalidateQueries({ queryKey: [owner, "library"] }),
        cache.invalidateQueries({ queryKey: [owner, "collections"] }),
        cache.invalidateQueries({ queryKey: discoverKeys.all(owner) }),
        cache.invalidateQueries({ queryKey: [owner, "imports"] }),
      ]);
      if (!mounted.current || liveScope.current !== scope || !isCurrentAccount()) return;
      toast("Workout deleted");
      router.replace("/(tabs)/library");
    } catch (e) {
      if (mounted.current && liveScope.current === scope && isCurrentAccount()) setError((e as Error).message);
    } finally { action.current = null; if (mounted.current) setDeleteBusy(false); }
  }
  const publication = workout?.publication;
  const isPublic = !!publication?.is_public;
  async function setShared(share: boolean) {
    if (!workout || publishing) return;
    setPublishing(true);
    setError("");
    setPublished(null);
    try {
      const result = share
        ? await disclosure.run(() => api.publishWorkout(workout.id, workout.generation))
        : await api.unpublishWorkout(workout.id, workout.generation);
      if (result === DECLINED) {
        toast("Kept private", "info");
        return;
      }
      cache.setQueryData<Workout>([owner, "workout", id, enrollment?.generation], (old) =>
        old ? { ...old, publication: result } : old
      );
      void cache.invalidateQueries({ queryKey: discoverKeys.all(owner) });
      void cache.invalidateQueries({ queryKey: [owner, "library"] });
      // Confirm next to the row that changed, so the swap is never silent (a toast can hide behind the disclosure sheet).
      const text = share ? "Shared to Discover. Anyone using Håfa Workouts can find and save it."
        : "Removed from Discover. People who already saved it keep their copy.";
      setPublished({ scope, text });
      AccessibilityInfo.announceForAccessibility?.(text);
    } catch (e) {
      setError(
        share && isIncomplete(e) && /discover|shar/i.test((e as { detail?: string }).detail ?? "")
          ? INCOMPLETE_MESSAGE
          : (e as Error).message
      );
    } finally {
      setPublishing(false);
    }
  }
  async function start(choice?: StartChoice) {
    if (!workout || !offline.store || action.current || !isCurrentAccount() || !workout.blocks.some(block => block.exercises.length)) return;
    action.current = "start";
    setBusy(true);
    try {
      await offline.store.start(
        workout,
        { workout_id: workout.id, workout_revision: workout.revision },
        Crypto.randomUUID(),
        undefined,
        choice
      );
      if (mounted.current && isCurrentAccount()) router.push("/training");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      action.current = null;
      setBusy(false);
      setChoosing(false);
    }
  }
  const trackingWarning = workout ? trackingPrescriptionWarning(workout) : null;
  // Several timed (AMRAP) parts need different words than missing set counts.
  const timedParts = !!trackingWarning && !!workout?.blocks.some((block) => block.execution);
  const exercises = workout?.blocks.reduce((n, b) => n + b.exercises.length, 0) ?? 0;
  const timeCap = workout?.blocks.length === 1 ? amrapCap(workout.blocks[0]) : null;
  const diagnostics = [...new Set(workout?.extraction_warnings ?? [])];
  const meta = workout ? workoutMeta({ minutes: workout.estimated_minutes, timeCap: timeCap != null ? formatSeconds(timeCap) : null,
    exercises, equipment: workout.equipment_required }) : undefined;
  const go = (to: Parameters<typeof router.push>[0]) => {
    setMore(false);
    router.push(to);
  };
  const recoverable = !!workout && (workout.provenance === "source" || !!workout.source_url || !!workout.capture_kind);
  const edit = () => go({ pathname: "/edit-workout/[id]", params: { id: workout!.id } });
  // One primary action: resume, start, schedule a program, or fill in an empty workout.
  const primary = !workout ? null : offline.state.active
    ? <Button title="Resume current session" icon="play" size="lg" disabled={!offline.ready} onPress={() => router.push("/training")} />
    : workout.kind === "program"
      ? <Button title="Schedule as a plan" icon="calendar-outline" size="lg"
        onPress={() => router.push({ pathname: "/review-plan", params: { workout_id: workout.id } })} />
      : exercises === 0
        ? <Button title={recoverable ? "Recover workout instructions" : "Add workout exercises"} icon="create-outline" size="lg"
          onPress={() => router.push({ pathname: recoverable ? "/recover-workout/[id]" : "/edit-workout/[id]", params: { id: workout.id } })} />
        : <Button title="Start workout" icon="play" size="lg" busy={busy} disabled={!offline.ready}
          onPress={() => { if (trackingWarning) { setError(""); setChoosing(true); } else void start(); }} />;
  const hint = !workout || offline.state.active ? null
    : workout.kind === "program" ? "This program runs over several days. Pick your days to train it."
      : exercises === 0 ? "No exercises yet."
        : timedParts ? "More than one timed part — you’ll choose how to track it."
          : trackingWarning ? "No set counts yet — you’ll choose rounds or log as you go." : null;
  return (
    <Screen
      back
      title={workout?.title ?? "Your workout."}
      // The hero leads; the title and meta line follow it in the page body.
      hideTitle
      action={workout ? <Row gap={4}>
        <IconButton icon="chatbubble-ellipses-outline" label="Ask the coach about this workout" variant="plain"
          onPress={() => router.push({ pathname: "/coach", params: { workout_id: workout.id, revision: String(workout.revision) } })} />
        {workout.kind !== "program" && <IconButton icon="share-outline" label="Share workout" variant="plain"
          onPress={() => router.push({ pathname: "/share", params: { id: workout.id, kind: "workout" } })} />}
        <IconButton icon="ellipsis-horizontal" label="More workout actions" variant="plain" onPress={() => setMore(true)} />
      </Row> : undefined}
      footer={primary ? <Stack gap={6}>
        {!!hint && <Copy kind="small" tone="muted" align="center">{hint}</Copy>}
        {primary}
      </Stack> : undefined}
    >
      {workout && <WorkoutHero source={workout} />}
      <Stack gap={6}>
        <Copy kind="title">{workout?.title ?? "Your workout."}</Copy>
        {!!meta && <Copy tone="muted">{meta}</Copy>}
      </Stack>
      {!!error && <Notice error>{error}</Notice>}
      {publication?.is_public && publication.moderation_status === "hidden" && (
        <Notice tone="warning">
          This workout was hidden from Discover after a review. It’s still in your library.
        </Notice>
      )}
      {workout?.organization?.archived && (
        <Notice>This workout is archived. Restore it in Organize when you want it back in the default library.</Notice>
      )}
      {published?.scope === scope && <Notice tone="success">{published.text}</Notice>}
      <QueryState hasData={q.data !== undefined}
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {!workout ? (
          <Empty
            icon="albums-outline"
            title="Workout not found"
            description="It may have been removed or belongs to another account. Return to your library to choose a workout."
          />
        ) : (
          <>
            <WorkoutInstructions instructions={workout.instructions} notes={workout.notes} />
            {exercises > 0 && <SectionHeader title="Exercises" />}
            {workout.blocks.map((block, index) => block.exercises.length > 0 && (
              <Card key={index}>
                <Copy kind="caption" tone="muted">
                  {[
                    block.label || null,
                    blockSummary(block, block.label),
                    block.rounds == null && block.grouping !== "sequential" && block.execution?.mode !== "amrap" ? "Rounds not specified" : null,
                    block.rest_between_rounds_seconds != null ? `${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : null,
                  ].filter(Boolean).join(" · ")}
                </Copy>
                {block.exercises.map((e, i) => (
                  <Row key={i} gap={14} align="flex-start">
                    <Copy kind="numericSmall" tone="muted" style={{ width: 24 }}>
                      {i + 1}
                    </Copy>
                    <Copy kind="label" style={{ flex: 1 }}>
                      {e.name}
                      {"\n"}
                      <Copy kind="small" tone="muted">{prescriptionLine(e)}</Copy>
                      {e.instructions ? <Copy kind="small">{"\n"}{e.instructions}</Copy> : null}
                      {e.notes ? <Copy kind="small">{"\n"}Private note · {e.notes}</Copy> : null}
                    </Copy>
                  </Row>
                ))}
              </Card>
            ))}
            {workout.kind === "session" && exercises > 0 && <ListGroup>
              <ListRow
                icon="calendar-outline"
                title="Schedule"
                detail="Choose a date for this workout"
                onPress={() => go({ pathname: "/schedule-once", params: { workout_id: workout.id } })}
              />
            </ListGroup>}
            <SectionHeader title="Source" />
            <Copy kind="small" tone="muted">{workoutOriginDescription(workout)}</Copy>
            <SavedSourceText context={workout.source_context} />
            {diagnostics.length > 0 && <Card compact tone="sunken">
              <Copy kind="subheading">Review workout details</Copy>
              <Copy kind="small">Some workout details need checking. Review the source or edit the details before training.</Copy>
              <Row gap={8} wrap>
                <Button title="Check details" secondary size="sm" inline onPress={edit} />
                {exercises > 0 && !!(workout.source_url || workout.capture_kind) && <Button
                  title="Recover from caption or source" secondary size="sm" inline icon="refresh-outline"
                  onPress={() => router.push({ pathname: "/recover-workout/[id]", params: { id: workout.id } })} />}
              </Row>
              <Button title={diagnosticScope === scope ? "Hide import diagnostics" : "Import diagnostics"} variant="ghost" size="sm" inline
                onPress={() => setDiagnosticScope(diagnosticScope === scope ? null : scope)} />
              {diagnosticScope === scope && diagnostics.map((warning, index) => <Copy key={index} kind="small">{warning}</Copy>)}
            </Card>}
          </>
        )}
      </QueryState>
      {workout && (
        <Sheet visible={more || deleting} onClose={() => { if (!deleteBusy) { setMore(false); setDeleting(false); } }} title={deleting ? "Delete workout?" : "Workout"}>
          {deleting ? <>
            <Copy>Delete “{workout.title}” from your library and Discover? This cannot be undone.</Copy>
            <Copy kind="small">Saved session history, workouts already in your plans and other people’s copies stay available. Save pending sessions on your other devices first.</Copy>
            {!!deleteBlock && <Notice tone="warning">{deleteBlock}</Notice>}
            {!!error && <Notice error>{error}</Notice>}
            <Button title="Delete workout" variant="destructive" icon="trash-outline" busy={deleteBusy} disabled={!!deleteBlock || busy} onPress={() => void remove()} />
            <Button title="Keep workout" secondary disabled={deleteBusy} onPress={() => setDeleting(false)} />
            <Button title="Archive instead" variant="ghost" disabled={deleteBusy} onPress={() => { setDeleting(false); go({ pathname: "/organize/[id]", params: { id: workout.id } }); }} />
          </> : <>
          <ListGroup>
            <WorkoutFavorite workout={workout} />
            <ListRow icon="folder-open-outline" title="Organize workout" detail="Collections, tags and archive"
              onPress={() => go({ pathname: "/organize/[id]", params: { id: workout.id } })} />
            {workout.kind === "program" && <ListRow icon="calendar-outline" title="Schedule as a plan" detail="Pick your days to train this program"
              onPress={() => go({ pathname: "/review-plan", params: { workout_id: workout.id } })} />}
            <ListRow icon="create-outline" title="Edit workout details" onPress={edit} />
            {capabilities.data?.cover_upload === true && <ListRow icon="image-outline"
              title={workout.source_thumbnail_url ? "Change cover photo" : "Choose cover photo"} disabled={busy || deleteBusy || publishing}
              onPress={() => { if (!action.current && isCurrentAccount()) go({ pathname: "/workout-cover/[id]", params: { id: workout.id } }); }} />}
          </ListGroup>
          {discoverOn && <ListGroup>
            <ListRow
              icon={isPublic ? "eye-off-outline" : "globe-outline"}
              title={isPublic ? "Remove from Discover" : "Share to Discover"}
              detail={isPublic ? "People who already saved it keep their copy" : "Anyone using Håfa Workouts can find and save it"}
              disabled={publishing}
              onPress={() => { setMore(false); void setShared(!isPublic); }}
            />
            {publication?.discover_visible && <ListRow icon="compass-outline" title="See it in Discover"
              onPress={() => go({ pathname: "/discover/[id]", params: { id: workout.id } })} />}
          </ListGroup>}
          <ListGroup>
            <ListRow icon="time-outline" title="Version history" onPress={() => go({ pathname: "/workout-history/[id]", params: { id: workout.id } })} />
            <ListRow icon="refresh-outline" title="Update from caption or link"
              onPress={() => go({ pathname: "/recover-workout/[id]", params: { id: workout.id } })} />
            <ListRow icon="trash-outline" title="Delete workout" detail="Remove from your library" destructive onPress={() => { setError(""); setDeleting(true); }} />
          </ListGroup>
          </>}
        </Sheet>
      )}
      {workout && <WorkoutStartSheet
        visible={choosing}
        busy={busy}
        timedParts={timedParts}
        onClose={() => { if (!busy) setChoosing(false); }}
        onStart={(choice) => void start(choice)}
        onEdit={() => { setChoosing(false); router.push({ pathname: "/edit-workout/[id]", params: { id: workout.id } }); }}
      />}
      {disclosure.sheet}
    </Screen>
  );
}

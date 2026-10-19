import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Chip,
  ChipRow,
  Copy,
  Empty,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  SectionHeader,
  Sheet,
  StatTile,
  Row,
  useToast,
} from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { usePublishingDisclosure } from "@/components/publishing-disclosure";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { DECLINED, INCOMPLETE_MESSAGE, discoverKeys, isIncomplete, prescriptionLine, formatSeconds } from "@/lib/discover";
import type { Workout } from "@/lib/models";
import { trackingPrescriptionWarning } from "@/lib/training";
import { WorkoutInstructions } from "@/components/workout-instructions";
import { WorkoutFavorite } from "@/components/workout-favorite";
import { WorkoutSource, WorkoutSourceHeader } from "@/components/workout-source";
import { workoutOriginDescription } from "@/lib/workout-presentation";
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
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
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
      toast(share ? "Shared to Discover" : "Removed from Discover");
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
  async function start() {
    if (!workout || !offline.store || action.current || !isCurrentAccount() || !workout.blocks.some(block => block.exercises.length)) return;
    action.current = "start";
    setBusy(true);
    try {
      await offline.store.start(
        workout,
        { workout_id: workout.id, workout_revision: workout.revision },
        Crypto.randomUUID()
      );
      if (mounted.current && isCurrentAccount()) router.push("/training");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      action.current = null;
      setBusy(false);
    }
  }
  const trackingWarning = workout ? trackingPrescriptionWarning(workout) : null;
  const exercises = workout?.blocks.reduce((n, b) => n + b.exercises.length, 0) ?? 0;
  const timeCap = workout?.blocks.length === 1 ? amrapCap(workout.blocks[0]) : null;
  const diagnostics = [...new Set(workout?.extraction_warnings ?? [])];
  const go = (to: Parameters<typeof router.push>[0]) => {
    setMore(false);
    router.push(to);
  };
  return (
    <Screen
      back
      eyebrow={workout ? `${workout.kind} · ${publication?.discover_visible ? "shared to Discover" : "private library"}` : "Private library"}
      title={workout?.title ?? "Your workout."}
      action={workout ? <IconButton icon="ellipsis-horizontal" label="More workout actions" onPress={() => setMore(true)} /> : undefined}
    >
      {workout && <WorkoutSourceHeader source={workout} />}
      {workout && (
        <Row gap={10}>
          {timeCap != null ? <Card compact style={{ flex: 1, minWidth: 96, gap: 4 }}>
            <Copy kind="numericSmall">{formatSeconds(timeCap)}</Copy>
            <Copy kind="small" tone="muted">AMRAP time cap</Copy>
          </Card> : <StatTile value={workout.estimated_minutes ?? "–"} unit={workout.estimated_minutes ? "min" : undefined} label="Estimated time" />}
          <StatTile value={exercises} label={exercises === 1 ? "Exercise" : "Exercises"} />
          <StatTile value={workout.blocks.length} label={workout.blocks.length === 1 ? "Block" : "Blocks"} />
        </Row>
      )}
      {workout && exercises === 0 && <Button
        title={workout.provenance === "source" || workout.source_url || workout.capture_kind ? "Recover workout instructions" : "Add workout exercises"}
        icon="create-outline" size="lg" onPress={() => router.push({
          pathname: workout.provenance === "source" || workout.source_url || workout.capture_kind ? "/recover-workout/[id]" : "/edit-workout/[id]",
          params: { id: workout.id },
        })} />}
      {workout && (exercises > 0 || offline.state.active) && (
        <Button
          title={offline.state.active ? "Resume current session" : "Start this workout"}
          icon="play"
          size="lg"
          busy={busy}
          disabled={!offline.ready || workout.kind === "program" || (!offline.state.active && (exercises === 0 || !!trackingWarning))}
          onPress={() => {
            if (offline.state.active) router.push("/training");
            else void start();
          }}
        />
      )}
      {trackingWarning && exercises > 0 && <Card compact>
        <Copy kind="subheading">Review before tracking</Copy>
        <Copy kind="small">{trackingWarning}</Copy>
        <Button title="Review tracking details" secondary onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id: workout!.id } })} />
      </Card>}
      {workout && exercises === 0 && <Notice tone="warning">This source has no extracted exercises yet. Check the source and edit its details before training.</Notice>}
      {workout?.kind === "program" && (
        <Card tone="sunken" compact>
          <Copy kind="small">
            This source describes a program. Review it as a dated training plan instead of performing all its blocks as
            one workout.
          </Copy>
          <Button
            title="Assign source blocks to a training schedule"
            secondary
            icon="calendar-outline"
            onPress={() => router.push({ pathname: "/review-plan", params: { workout_id: workout.id } })}
          />
        </Card>
      )}
      {publication?.is_public && publication.moderation_status === "hidden" && (
        <Notice tone="warning">
          This workout was hidden from Discover after a review. It’s still in your library.
        </Notice>
      )}
      {workout?.organization?.archived && (
        <Notice>This workout is archived. Restore it in Organize when you want it back in the default library.</Notice>
      )}
      {workout && <Row gap={10} wrap>
        <WorkoutFavorite workout={workout} />
        <Button title="Organize workout" icon="folder-open-outline" secondary size="sm" inline
          onPress={() => router.push({ pathname: "/organize/[id]", params: { id: workout.id } })} />
      </Row>}
      {!!error && <Notice error>{error}</Notice>}
      <QueryState
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
            {!!workout.equipment_required?.length && (
              <ChipRow wrap label="Equipment">
                {workout.equipment_required.map((item) => (
                  <Chip key={item} label={item} icon="barbell-outline" />
                ))}
              </ChipRow>
            )}
            <Copy kind="small" tone="muted">
              {workoutOriginDescription(workout)}
            </Copy>
            {workout.blocks.map((block, index) => (
              <Card key={index}>
                <Copy kind="caption" tone="accent">
                  {block.label ? `${block.label} · ` : ""}
                  {blockSummary(block)}
                  {block.rounds == null && block.grouping !== "sequential" && block.execution?.mode !== "amrap" ? " · Rounds not specified" : ""}
                  {block.rest_between_rounds_seconds != null ? ` · ${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : ""}
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
            {diagnostics.length > 0 && <Card compact tone="sunken">
              <Copy kind="subheading">Review workout details</Copy>
              <Copy kind="small">Some workout details need checking. Review the source or edit the details before training.</Copy>
              <Button title="Check details" secondary onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id: workout.id } })} />
              {exercises > 0 && !!(workout.source_url || workout.capture_kind) && <Button
                title="Recover from caption or source" secondary icon="refresh-outline"
                onPress={() => router.push({ pathname: "/recover-workout/[id]", params: { id: workout.id } })} />}
              <Button title={diagnosticScope === scope ? "Hide import diagnostics" : "Import diagnostics"} variant="ghost"
                onPress={() => setDiagnosticScope(diagnosticScope === scope ? null : scope)} />
              {diagnosticScope === scope && diagnostics.map((warning, index) => <Copy key={index} kind="small">{warning}</Copy>)}
            </Card>}
            <WorkoutSource source={workout} showOriginal={false} showIdentity={false} />
            {capabilities.data?.cover_upload === true && <Button
              title={workout.source_thumbnail_url ? "Change cover photo" : "Choose cover photo"} secondary icon="image-outline"
              disabled={busy || deleteBusy || publishing} onPress={() => { if (!action.current && isCurrentAccount()) router.push({ pathname: "/workout-cover/[id]", params: { id: workout.id } }); }} /> }
            {workout.source_url && /^https?:\/\//i.test(workout.source_url) && (
              <Button title="Open original source" icon="open-outline" secondary onPress={() => {
                void Linking.openURL(workout.source_url!).catch(() => setError("Could not open the original source."));
              }} />
            )}
            <SectionHeader title="Make it yours" />
            <ListGroup>
              {workout.kind === "session" && <ListRow
                icon="calendar-outline"
                title="Add to a plan"
                disabled={exercises === 0 || !!trackingWarning}
                detail="Choose your days and keep this workout selected"
                onPress={() => router.push({ pathname: "/build-plan", params: { include: workout.id } })}
              />}
              <ListRow
                icon="chatbubble-ellipses-outline"
                title="Chat about this workout"
                onPress={() =>
                  router.push({ pathname: "/coach", params: { workout_id: workout.id, revision: String(workout.revision) } })
                }
              />
              <ListRow
                icon="create-outline"
                title="Edit workout details"
                onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id: workout.id } })}
              />
              {discoverOn && (
                <ListRow
                  icon={isPublic ? "eye-off-outline" : "globe-outline"}
                  title={isPublic ? "Remove from Discover" : "Share to Discover"}
                  detail={
                    isPublic
                      ? "People who already saved it keep their copy"
                      : "Anyone using Håfa Workouts can find and save it"
                  }
                  disabled={publishing}
                  onPress={() => void setShared(!isPublic)}
                />
              )}
              {discoverOn && publication?.discover_visible && (
                <ListRow
                  icon="compass-outline"
                  title="See it in Discover"
                  onPress={() => router.push({ pathname: "/discover/[id]", params: { id: workout.id } })}
                />
              )}
            </ListGroup>
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
          <ListRow
            icon="chatbubble-ellipses-outline"
            title="Chat about this workout"
            onPress={() => go({ pathname: "/coach", params: { workout_id: workout.id, revision: String(workout.revision) } })}
          />
          <ListRow
            icon="share-outline"
            title="Share selected workout"
            detail={workout.kind === "program" ? "Programs can’t be shared as one workout" : undefined}
            disabled={workout.kind === "program"}
            onPress={() => go({ pathname: "/share", params: { id: workout.id, kind: "workout" } })}
          />
          {discoverOn && (
            <ListRow
              icon={isPublic ? "eye-off-outline" : "globe-outline"}
              title={isPublic ? "Remove from Discover" : "Share to Discover"}
              disabled={publishing}
              onPress={() => {
                // Let this sheet finish dismissing before a disclosure sheet may open (iOS can't stack modals mid-dismiss).
                setMore(false);
                setTimeout(() => void setShared(!isPublic), 400);
              }}
            />
          )}
          <ListRow
            icon="folder-open-outline"
            title="Organize or duplicate workout"
            onPress={() => go({ pathname: "/organize/[id]", params: { id: workout.id } })}
          />
          <ListRow icon="time-outline" title="Version history" onPress={() => go({ pathname: "/workout-history/[id]", params: { id: workout.id } })} />
          <ListRow icon="refresh-outline" title="Update from caption or link"
            onPress={() => go({ pathname: "/recover-workout/[id]", params: { id: workout.id } })} />
          <ListRow
            icon="create-outline"
            title="Edit workout details"
            onPress={() => go({ pathname: "/edit-workout/[id]", params: { id: workout.id } })}
          />
          <ListRow icon="trash-outline" title="Delete workout" detail="Remove from your library" onPress={() => { setError(""); setDeleting(true); }} />
          </>}
        </Sheet>
      )}
      {disclosure.sheet}
    </Screen>
  );
}

import { useState } from "react";
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
import { WorkoutSource } from "@/components/workout-source";
export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner, enrollment } = useTraining();
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
  const [publishing, setPublishing] = useState(false);
  const cache = useQueryClient();
  const toast = useToast();
  const disclosure = usePublishingDisclosure();
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", enrollment?.generation],
    queryFn: api.capabilities,
    staleTime: 60000,
  });
  const discoverOn = capabilities.data?.discover === true;
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
    if (!workout || !offline.store || !workout.blocks.some(block => block.exercises.length)) return;
    setBusy(true);
    try {
      await offline.store.start(
        workout,
        { workout_id: workout.id, workout_revision: workout.revision },
        Crypto.randomUUID()
      );
      router.push("/training");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const trackingWarning = workout ? trackingPrescriptionWarning(workout) : null;
  const exercises = workout?.blocks.reduce((n, b) => n + b.exercises.length, 0) ?? 0;
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
      {workout && (
        <Row gap={10}>
          <StatTile value={workout.estimated_minutes ?? "–"} unit={workout.estimated_minutes ? "min" : undefined} label="Estimated time" />
          <StatTile value={exercises} label={exercises === 1 ? "Exercise" : "Exercises"} />
          <StatTile value={workout.blocks.length} label={workout.blocks.length === 1 ? "Block" : "Blocks"} />
        </Row>
      )}
      {workout && (
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
      {trackingWarning && <Card compact>
        <Copy kind="subheading">Review before tracking</Copy>
        <Copy kind="small">{trackingWarning}</Copy>
        <Button title="Review tracking details" secondary onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id: workout!.id } })} />
      </Card>}
      {workout && exercises === 0 && <Notice tone="warning">This source has no extracted exercises yet. Check the source and edit its details before training.</Notice>}
      {workout && (exercises === 0 || !!workout.extraction_warnings?.length) && !!(workout.source_url || workout.capture_kind) && <Card compact>
        <Copy kind="subheading">Recover the source</Copy>
        <Copy kind="small">Try its link again or paste the creator’s caption or transcript. Your saved draft stays unchanged.</Copy>
        <Button title="Recover from caption or source" secondary icon="refresh-outline" onPress={() => router.push({ pathname: "/recover-workout/[id]", params: { id: workout.id } })} />
      </Card>}
      {!!workout?.extraction_warnings?.length && <Card compact tone="sunken">
        <Copy kind="subheading">Details to check</Copy>
        {workout.extraction_warnings.map((warning, index) => <Copy key={index} kind="small">{warning}</Copy>)}
        <Button title="Check details" secondary onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id: workout!.id } })} />
      </Card>}
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
            <WorkoutInstructions notes={workout.notes} />
            {!!workout.equipment_required?.length && (
              <ChipRow wrap label="Equipment">
                {workout.equipment_required.map((item) => (
                  <Chip key={item} label={item} icon="barbell-outline" />
                ))}
              </ChipRow>
            )}
            <Copy kind="small" tone="muted">
              {workout.provenance === "source"
                ? workout.revision > 1 || workout.blocks.some((block) => block.exercises.some((exercise) => exercise.provenance === "user"))
                  ? "Saved source prescription with your corrections."
                  : "Original source prescription. Missing details stay missing."
                : workout.provenance === "suggestion"
                  ? "Suggested prescription. Review it before training."
                  : "Your manually entered workout."}
            </Copy>
            {workout.blocks.map((block, index) => (
              <Card key={index}>
                <Copy kind="caption" tone="accent">
                  {block.label ? `${block.label} · ` : ""}
                  {block.grouping}
                  {block.rounds ? ` · ${block.rounds} rounds` : ""}
                  {block.rounds == null && block.grouping !== "sequential" ? " · Rounds not specified" : ""}
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
                      {e.notes ? <Copy kind="small">{"\n"}{e.notes}</Copy> : null}
                    </Copy>
                  </Row>
                ))}
              </Card>
            ))}
            <WorkoutSource source={workout} />
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
        <Sheet visible={more} onClose={() => setMore(false)} title="Workout">
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
          <ListRow
            icon="create-outline"
            title="Edit workout details"
            onPress={() => go({ pathname: "/edit-workout/[id]", params: { id: workout.id } })}
          />
        </Sheet>
      )}
      {disclosure.sheet}
    </Screen>
  );
}

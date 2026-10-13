import { useState } from "react";
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
import { DECLINED, INCOMPLETE_MESSAGE, discoverKeys, isIncomplete } from "@/lib/discover";
import type { Workout } from "@/lib/models";
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
    setMore(false);
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
      setError(share && isIncomplete(e) ? INCOMPLETE_MESSAGE : (e as Error).message);
    } finally {
      setPublishing(false);
    }
  }
  async function start() {
    if (!workout || !offline.store) return;
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
  const exercises = workout?.blocks.reduce((n, b) => n + b.exercises.length, 0) ?? 0;
  const go = (to: Parameters<typeof router.push>[0]) => {
    setMore(false);
    router.push(to);
  };
  return (
    <Screen
      back
      eyebrow={workout ? `${workout.kind} · ${isPublic ? "shared to Discover" : "private library"}` : "Private library"}
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
          disabled={!offline.ready || workout.kind === "program"}
          onPress={() => {
            if (offline.state.active) router.push("/training");
            else void start();
          }}
        />
      )}
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
            {!!workout.equipment_required?.length && (
              <ChipRow wrap label="Equipment">
                {workout.equipment_required.map((item) => (
                  <Chip key={item} label={item} icon="barbell-outline" />
                ))}
              </ChipRow>
            )}
            <Copy kind="small" tone="muted">
              {workout.provenance === "source"
                ? "Original source prescription. Missing details stay missing."
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
                </Copy>
                {block.exercises.map((e, i) => (
                  <Row key={i} gap={14} align="flex-start">
                    <Copy kind="numericSmall" tone="muted" style={{ width: 24 }}>
                      {i + 1}
                    </Copy>
                    <Copy kind="label" style={{ flex: 1 }}>
                      {e.name}
                      {"\n"}
                      <Copy kind="small" tone={e.sets == null || e.reps_min == null ? "accent" : "muted"}>
                        {e.sets == null ? "Sets not specified" : `${e.sets} sets`} ·{" "}
                        {e.reps_min == null
                          ? "Reps not specified"
                          : e.reps_max != null && e.reps_max !== e.reps_min
                            ? `${e.reps_min}–${e.reps_max} reps`
                            : `${e.reps_min} reps`}
                      </Copy>
                    </Copy>
                  </Row>
                ))}
              </Card>
            ))}
            <SectionHeader title="Make it yours" />
            <ListGroup>
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
              onPress={() => void setShared(!isPublic)}
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

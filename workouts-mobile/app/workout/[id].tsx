import { useState } from "react";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Button, Card, Copy, Empty, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
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
  return (
    <Screen back title={workout?.title ?? "Your workout."} subtitle="Private library">
      {workout && (
        <Button
          title={offline.state.active ? "Resume current session" : "Start this workout"}
          busy={busy}
          disabled={!offline.ready || workout.kind === "program"}
          onPress={() => {
            if (offline.state.active) router.push("/training");
            else void start();
          }}
        />
      )}
      {workout?.kind === "program" && (
        <>
          <Notice>
            This source describes a program. Review it as a dated training plan instead of performing all its blocks as
            one workout.
          </Notice>
          <Button
            title="Assign source blocks to a training schedule"
            secondary
            onPress={() => router.push({ pathname: "/review-plan", params: { workout_id: workout.id } })}
          />
        </>
      )}
      {workout && (
        <Button
          title="Chat about this workout"
          secondary
          onPress={() =>
            router.push({ pathname: "/coach", params: { workout_id: workout.id, revision: String(workout.revision) } })
          }
        />
      )}
      {workout && (
        <Button
          title="Edit workout details"
          secondary
          onPress={() => router.push({ pathname: "/edit-workout/[id]", params: { id: workout.id } })}
        />
      )}
      {workout && (
        <Button
          title="Share selected workout"
          disabled={workout.kind === "program"}
          secondary
          onPress={() => router.push({ pathname: "/share", params: { id: workout.id, kind: "workout" } })}
        />
      )}
      {workout && (
        <Button
          title="Organize or duplicate workout"
          secondary
          onPress={() => router.push({ pathname: "/organize/[id]", params: { id: workout.id } })}
        />
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
            <Notice>
              {workout.provenance === "source"
                ? "Original source prescription. Missing details stay missing."
                : workout.provenance === "suggestion"
                  ? "Suggested prescription. Review it before training."
                  : "Your manually entered workout."}
            </Notice>
            {workout.equipment_required?.length ? (
              <Copy>Equipment · {workout.equipment_required.join(", ")}</Copy>
            ) : null}
            {workout.blocks.map((block, index) => (
              <Card key={index}>
                <Copy kind="label">
                  {block.grouping.toUpperCase()}
                  {block.rounds ? ` · ${block.rounds} rounds` : ""}
                </Copy>
                {block.exercises.map((e, i) => (
                  <Card key={i}>
                    <Copy kind="heading">{e.name}</Copy>
                    <Copy>
                      {e.sets == null ? "Sets not specified" : `${e.sets} sets`} ·{" "}
                      {e.reps_min == null
                        ? "Reps not specified"
                        : e.reps_max != null && e.reps_max !== e.reps_min
                          ? `${e.reps_min}–${e.reps_max} reps`
                          : `${e.reps_min} reps`}
                    </Copy>
                  </Card>
                ))}
              </Card>
            ))}
          </>
        )}
      </QueryState>
    </Screen>
  );
}

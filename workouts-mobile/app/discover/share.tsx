import { useEffect, useState } from "react";
import { router } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Empty, Field, ListGroup, ListRow, Notice, Screen, SkeletonCard, Stack, useToast } from "@/components/ui";
import { usePublishingDisclosure } from "@/components/publishing-disclosure";
import { useTraining } from "@/lib/context";
import { DECLINED, INCOMPLETE_MESSAGE, SEARCH_DEBOUNCE_MS, discoverKeys, isIncomplete } from "@/lib/discover";
import type { Workout } from "@/lib/models";
import { workoutMeta } from "@/lib/plan-presentation";

/** Pick a private workout from your library and share it to Discover. */
export default function ShareToDiscover() {
  const { api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const toast = useToast();
  const disclosure = usePublishingDisclosure();
  const [search, setSearch] = useState("");
  const [settled, setSettled] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ workout: Workout; message: string; incomplete: boolean } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const generation = enrollment?.enrolled ? enrollment.generation : null;
  const filters = { q: settled };
  const q = useInfiniteQuery({
    queryKey: [owner, "library", enrollment?.generation, "search", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.searchLibrary(filters, pageParam, generation ?? 0),
    getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    enabled: generation != null,
  });
  const all = [...new Map(q.data?.pages.flatMap((page) => page.items).map((w) => [w.id, w]) ?? []).values()];
  const shareable = all.filter((workout) => !workout.publication?.is_public);
  // Shared workouts are filtered on the device, so keep reading until a private one appears.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = q;
  useEffect(() => {
    if (!shareable.length && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [shareable.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  async function share(workout: Workout) {
    if (busy) return;
    setBusy(workout.id);
    setFailure(null);
    try {
      const result = await disclosure.run(() => api.publishWorkout(workout.id, workout.generation));
      if (result === DECLINED) {
        toast("Kept private", "info");
        return;
      }
      void cache.invalidateQueries({ queryKey: discoverKeys.all(owner) });
      void cache.invalidateQueries({ queryKey: [owner, "library"] });
      void cache.invalidateQueries({ queryKey: [owner, "workout", workout.id] });
      toast("Shared to Discover");
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/discover");
    } catch (e) {
      // Same guard as the workout page: only the publish-completeness 422 means missing details.
      const incomplete = isIncomplete(e) && /discover|shar/i.test((e as { detail?: string }).detail ?? "");
      setFailure({ workout, incomplete, message: incomplete ? INCOMPLETE_MESSAGE : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen
      back
      title="Share a workout"
      subtitle="People using Håfa Workouts can find and save it. Your notes and training history stay private."
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
      }}
    >
      {generation == null ? (
        <Notice>Finish setting up Håfa Workouts to share workouts.</Notice>
      ) : q.isPending ? (
        <SkeletonCard lines={3} label="Loading your workouts" />
      ) : q.error && !all.length ? (
        <Stack>
          <Notice error>{q.error.message}</Notice>
          <Button title="Try again" variant="secondary" onPress={() => void q.refetch()} />
        </Stack>
      ) : !all.length && !settled ? (
        <Empty
          icon="albums-outline"
          title="Nothing to share yet"
          description="Import a workout from a video, link or photo first. Then you can share it here."
          action={<Button title="Import a workout" icon="add" onPress={() => router.navigate("/(tabs)/extract")} />}
        />
      ) : (
        <>
          <Field label="Search your library" value={search} onChange={setSearch} placeholder="Workout or exercise" />
          {!!failure && (
            <Stack gap={8}>
              <Notice error>{failure.message}</Notice>
              {failure.incomplete && (
                <Button
                  title={`Open ${failure.workout.title}`}
                  variant="secondary"
                  inline
                  onPress={() => router.push({ pathname: "/workout/[id]", params: { id: failure.workout.id } })}
                />
              )}
            </Stack>
          )}
          {shareable.length ? (
            <ListGroup>
              {shareable.map((workout) => (
                <ListRow
                  key={workout.id}
                  icon={busy === workout.id ? "hourglass-outline" : "globe-outline"}
                  title={workout.title}
                  detail={workoutMeta({
                    minutes: workout.estimated_minutes,
                    exercises: workout.blocks.reduce((sum, block) => sum + block.exercises.length, 0),
                  })}
                  value={busy === workout.id ? "Sharing…" : undefined}
                  disabled={!!busy}
                  onPress={() => void share(workout)}
                />
              ))}
            </ListGroup>
          ) : q.hasNextPage || q.isFetchingNextPage ? (
            <SkeletonCard lines={2} label="Loading more of your workouts" />
          ) : (
            <Notice>
              {settled ? "No private workouts match that search." : "Everything in your library is already shared."}
            </Notice>
          )}
          {q.hasNextPage && !!shareable.length && (
            <Button
              title="Show more"
              variant="secondary"
              busy={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
            />
          )}
        </>
      )}
      {disclosure.sheet}
    </Screen>
  );
}

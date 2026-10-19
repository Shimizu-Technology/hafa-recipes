import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  AccountButton,
  Button,
  Chip,
  ChipRow,
  Copy,
  Empty,
  Field,
  IconButton,
  Notice,
  Row,
  Screen,
  Stack,
} from "@/components/ui";
import { DiscoverCardSkeleton, DiscoverCardView } from "@/components/discover-card";
import { WorkoutGallery } from "@/components/workout-gallery";
import { useTraining } from "@/lib/context";
import {
  DISCOVER_STALE_MS,
  SEARCH_DEBOUNCE_MS,
  discoverKeys,
  discoverUnavailable,
  durationRanges,
  equipmentFilters,
  nextDiscoverOffset,
  platformFilters,
  platformInfo,
  uniqueCards,
  type DiscoverFilters,
  type DurationRange,
} from "@/lib/discover";

export default function Discover() {
  const { api, owner, enrollment } = useTraining();
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [equipment, setEquipment] = useState<string>();
  const [duration, setDuration] = useState<DurationRange>();
  const [platform, setPlatform] = useState<string>();
  const [pulling, setPulling] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", enrollment?.generation],
    queryFn: api.capabilities,
    staleTime: DISCOVER_STALE_MS,
  });
  const ready = capabilities.data?.discover === true;
  const filters: DiscoverFilters = { q: settledSearch, equipment, duration, platform };
  const feed = useInfiniteQuery({
    queryKey: discoverKeys.feed(owner, enrollment?.generation, filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.discover(filters, pageParam, signal),
    getNextPageParam: nextDiscoverOffset,
    enabled: ready,
    staleTime: DISCOVER_STALE_MS,
    // A 503 means Discover isn't switched on yet; retrying won't help.
    retry: (count, error) => (error as { status?: number }).status !== 503 && count < 1,
  });
  const unavailable =
    discoverUnavailable(capabilities.data, feed.error) || (capabilities.error as { status?: number } | null)?.status === 503;
  const cards = uniqueCards(feed.data?.pages);
  const narrowed = !!(settledSearch.trim() || equipment || duration || platform);
  function clear() {
    setSearch("");
    setSettledSearch("");
    setEquipment(undefined);
    setDuration(undefined);
    setPlatform(undefined);
  }
  async function refresh() {
    setPulling(true);
    try {
      const caps = await capabilities.refetch();
      if (caps.data?.discover) await feed.refetch();
    } finally {
      setPulling(false);
    }
  }
  const loadingFeed = capabilities.isPending || (ready && feed.isPending);
  return (
    <Screen
      title="Discover"
      refreshing={pulling}
      onRefresh={() => {
        void refresh();
      }}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) void feed.fetchNextPage();
      }}
      action={
        <Row gap={8}>
          <IconButton
            icon="add"
            label="Share a workout video"
            variant="primary"
            disabled={!enrollment?.enrolled}
            onPress={() => router.push("/capture")}
          />
          <AccountButton />
        </Row>
      }
    >
      {unavailable ? (
        <Empty
          mark
          icon="compass-outline"
          title="Discover is getting ready"
          description="Soon you’ll find workouts other Håfa members have shared here. Your library, plans and training work as usual."
          action={<Button title="Open your library" variant="secondary" onPress={() => router.navigate("/(tabs)/library")} />}
        />
      ) : capabilities.error ? (
        <Stack>
          <Notice>{capabilities.error.message}</Notice>
          <Button title="Try again" variant="secondary" onPress={() => void capabilities.refetch()} />
        </Stack>
      ) : (
        <>
          <Field label="Search Discover" value={search} onChange={setSearch} placeholder="Workout, exercise or creator" />
          <ChipRow label="Filter workouts">
            {equipmentFilters
              .filter((item) => item.value === "none")
              .map((item) => (
                <Chip
                  key={item.value}
                  label={item.label}
                  icon={item.icon}
                  selected={equipment === item.value}
                  onPress={() => setEquipment(equipment === item.value ? undefined : item.value)}
                />
              ))}
            {(Object.keys(durationRanges) as DurationRange[]).map((value) => (
              <Chip
                key={value}
                label={durationRanges[value].label}
                icon="time-outline"
                selected={duration === value}
                onPress={() => setDuration(duration === value ? undefined : value)}
              />
            ))}
            {platformFilters.map((value) => (
              <Chip
                key={value}
                label={platformInfo(value).label}
                icon={platformInfo(value).icon}
                selected={platform === value}
                onPress={() => setPlatform(platform === value ? undefined : value)}
              />
            ))}
            {equipmentFilters
              .filter((item) => item.value !== "none")
              .map((item) => (
                <Chip
                  key={item.value}
                  label={item.label}
                  icon="barbell-outline"
                  selected={equipment === item.value}
                  onPress={() => setEquipment(equipment === item.value ? undefined : item.value)}
                />
              ))}
          </ChipRow>
          {loadingFeed ? (
            <>
              <DiscoverCardSkeleton />
              <DiscoverCardSkeleton />
            </>
          ) : feed.error && !cards.length ? (
            <Stack>
              <Notice>{feed.error.message}</Notice>
              <Button title="Try again" variant="secondary" onPress={() => void feed.refetch()} />
            </Stack>
          ) : !cards.length ? (
            <Empty
              icon={narrowed ? "search-outline" : "compass-outline"}
              title={narrowed ? "No workouts match" : "Be the first to share"}
              description={
                narrowed
                  ? "Try a shorter search or clear the filters."
                  : "Share a workout video to Håfa Workouts and turn on Share to Discover when you save it."
              }
              action={
                narrowed ? (
                  <Button title="Clear filters" variant="secondary" onPress={clear} />
                ) : (
                  <Button
                    title="Share a workout video"
                    icon="add"
                    variant="secondary"
                    disabled={!enrollment?.enrolled}
                    onPress={() => router.push("/capture")}
                  />
                )
              }
            />
          ) : (
            <>
              <Row justify="space-between">
                <Copy kind="small" tone="muted">
                  {feed.data?.pages[0]?.total ?? cards.length} {(feed.data?.pages[0]?.total ?? cards.length) === 1 ? "workout" : "workouts"}
                </Copy>
                {narrowed && <Button title="Clear filters" variant="ghost" size="sm" inline onPress={clear} />}
              </Row>
              <WorkoutGallery>{cards.map((card) => (
                <DiscoverCardView
                  key={card.id}
                  card={card}
                  onPress={() => router.push({ pathname: "/discover/[id]", params: { id: card.id } })}
                />
              ))}</WorkoutGallery>
              {feed.isFetchingNextPage && <DiscoverCardSkeleton />}
              {feed.isFetchNextPageError && <Notice>{feed.error?.message}</Notice>}
              {feed.hasNextPage && !feed.isFetchingNextPage && (
                <Button
                  title={feed.isFetchNextPageError ? "Try loading more again" : "Show more workouts"}
                  variant="secondary"
                  onPress={() => void feed.fetchNextPage()}
                />
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

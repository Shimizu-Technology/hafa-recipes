import { useEffect, useRef, useState, type ReactNode } from "react";
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
  Sheet,
  Stack,
} from "@/components/ui";
import { DiscoverCardSkeleton, DiscoverCardView } from "@/components/discover-card";
import { DiscoverGrid, DiscoverGridCard, DiscoverGridSkeleton } from "@/components/discover-grid-card";
import { WorkoutGallery } from "@/components/workout-gallery";
import { useTraining } from "@/lib/context";
import {
  DISCOVER_STALE_MS,
  SEARCH_DEBOUNCE_MS,
  activeFilters,
  discoverKeys,
  discoverUnavailable,
  discoverViewKey,
  durationRanges,
  equipmentFilters,
  nextDiscoverOffset,
  parseDiscoverView,
  platformFilters,
  platformInfo,
  uniqueCards,
  type DiscoverCard,
  type DiscoverFilterKey,
  type DiscoverFilters,
  type DiscoverView,
  type DurationRange,
} from "@/lib/discover";

/** Grid or list, remembered on this device for this account. */
function useDiscoverView() {
  const { owner, storage } = useTraining();
  const [view, setView] = useState<DiscoverView>("grid");
  const chosen = useRef(false);
  useEffect(() => {
    let live = true;
    storage
      .getItem(discoverViewKey(owner))
      // A tap before the saved choice loads wins over the stored value.
      .then((value) => live && !chosen.current && setView(parseDiscoverView(value)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [owner, storage]);
  function toggle() {
    const next = view === "grid" ? "list" : "grid";
    chosen.current = true;
    setView(next);
    storage.setItem(discoverViewKey(owner), next).catch(() => undefined);
  }
  return [view, toggle] as const;
}

export default function Discover() {
  const { api, owner, enrollment } = useTraining();
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [equipment, setEquipment] = useState<string>();
  const [duration, setDuration] = useState<DurationRange>();
  const [platform, setPlatform] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, toggleView] = useDiscoverView();
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
  const active = activeFilters(filters);
  const narrowed = !!(settledSearch.trim() || active.length);
  const total = feed.data?.pages[0]?.total ?? cards.length;
  function clearFilter(key: DiscoverFilterKey) {
    ({ duration: setDuration, equipment: setEquipment, platform: setPlatform })[key](undefined);
  }
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
  const open = (card: DiscoverCard) => router.push({ pathname: "/discover/[id]", params: { id: card.id } });
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
      action={<AccountButton />}
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
          <Row justify="space-between">
            <Button
              title={active.length ? `Filters · ${active.length}` : "Filters"}
              icon="options-outline"
              variant="secondary"
              size="sm"
              inline
              accessibilityHint={active.length ? `${active.length} active` : "Time, equipment and source"}
              onPress={() => setFiltersOpen(true)}
            />
            <IconButton
              icon={view === "grid" ? "list-outline" : "grid-outline"}
              label={view === "grid" ? "Show workouts as a list" : "Show workouts as a grid"}
              onPress={toggleView}
            />
          </Row>
          {!!active.length && (
            <ChipRow label="Active filters">
              {active.map((filter) => (
                <Chip
                  key={filter.key}
                  label={filter.label}
                  selected
                  onPress={() => clearFilter(filter.key)}
                />
              ))}
              <Button title="Clear all" variant="ghost" size="sm" inline onPress={clear} />
            </ChipRow>
          )}
          {loadingFeed ? (
            view === "grid" ? <DiscoverGridSkeleton /> : <DiscoverCardSkeleton />
          ) : feed.error && !cards.length ? (
            <Stack>
              <Notice>{feed.error.message}</Notice>
              <Button title="Try again" variant="secondary" onPress={() => void feed.refetch()} />
            </Stack>
          ) : !cards.length ? (
            narrowed ? (
              <Empty
                icon="search-outline"
                title="No workouts match"
                description="Try a shorter search or fewer filters."
                action={<Button title="Clear search and filters" variant="secondary" onPress={clear} />}
              />
            ) : (
              <Empty
                mark
                icon="compass-outline"
                title="Discover is just getting started"
                description="Discover shows workouts Håfa members choose to share. Share one from your library, or import a workout from a video or link."
                action={
                  <Row gap={8} wrap>
                    <Button
                      title="Share one of yours"
                      icon="globe-outline"
                      size="sm"
                      inline
                      disabled={!enrollment?.enrolled}
                      onPress={() => router.push("/discover/share")}
                    />
                    <Button
                      title="Import a workout"
                      icon="add"
                      variant="secondary"
                      size="sm"
                      inline
                      onPress={() => router.navigate("/(tabs)/extract")}
                    />
                  </Row>
                }
              />
            )
          ) : (
            <>
              <Copy kind="small" tone="muted">
                {total} {total === 1 ? "workout" : "workouts"}
              </Copy>
              {view === "grid" ? (
                <DiscoverGrid>
                  {cards.map((card) => (
                    <DiscoverGridCard key={card.id} card={card} onPress={() => open(card)} />
                  ))}
                </DiscoverGrid>
              ) : (
                <WorkoutGallery>
                  {cards.map((card) => (
                    <DiscoverCardView key={card.id} card={card} onPress={() => open(card)} />
                  ))}
                </WorkoutGallery>
              )}
              {feed.isFetchingNextPage && (view === "grid" ? <DiscoverGridSkeleton count={2} /> : <DiscoverCardSkeleton />)}
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
      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <Stack gap={16}>
          <FilterGroup title="Time">
            {(Object.keys(durationRanges) as DurationRange[]).map((value) => (
              <Chip
                key={value}
                label={durationRanges[value].label}
                selected={duration === value}
                onPress={() => setDuration(duration === value ? undefined : value)}
              />
            ))}
          </FilterGroup>
          <FilterGroup title="Equipment">
            {equipmentFilters.map((item) => (
              <Chip
                key={item.value}
                label={item.label}
                selected={equipment === item.value}
                onPress={() => setEquipment(equipment === item.value ? undefined : item.value)}
              />
            ))}
          </FilterGroup>
          <FilterGroup title="Source">
            {platformFilters.map((value) => (
              <Chip
                key={value}
                label={platformInfo(value).label}
                icon={platformInfo(value).icon}
                selected={platform === value}
                onPress={() => setPlatform(platform === value ? undefined : value)}
              />
            ))}
          </FilterGroup>
          <Row gap={8} justify="flex-end">
            {!!active.length && (
              <Button
                title="Clear all"
                variant="ghost"
                inline
                onPress={() => {
                  setEquipment(undefined);
                  setDuration(undefined);
                  setPlatform(undefined);
                }}
              />
            )}
            <Button title="Show workouts" inline onPress={() => setFiltersOpen(false)} />
          </Row>
        </Stack>
      </Sheet>
    </Screen>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={8}>
      <Copy kind="label">{title}</Copy>
      <ChipRow wrap label={title}>
        {children}
      </ChipRow>
    </Stack>
  );
}

import { BrowseHeader } from "@/components/native-tab-stack";
import { BrowseLinks } from "@/components/browse-links";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack as RouterStack, router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import {
  Button,
  Chip,
  ChipRow,
  Copy,
  Empty,
  Notice,
  ListGroup,
  ListRow,
  haptics,
  Row,
  Screen,
  Sheet,
  Stack,
  useToast,
} from "@/components/ui";
import { DiscoverCardSkeleton } from "@/components/discover-card";
import { DiscoverGrid, DiscoverGridCard, DiscoverGridSkeleton } from "@/components/discover-grid-card";
import { useTraining } from "@/lib/context";
import {
  DISCOVER_STALE_MS,
  SEARCH_DEBOUNCE_MS,
  activeFilters,
  contributorChip,
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
    chosen.current = false;
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
  const { api, owner, enrollment, isCurrentAccount } = useTraining();
  const params = useLocalSearchParams<{ q?: string }>();
  const cache = useQueryClient();
  const [expandedSection, setExpandedSection] = useState<string>();
  const [menu, setMenu] = useState(false);
  const [saving, setSaving] = useState<string>();
  const saveLock = useRef(false);
  const [search, setSearch] = useState(params.q ?? "");
  const [settledSearch, setSettledSearch] = useState(params.q ?? "");
  useEffect(() => { setSearch(params.q ?? ""); setSettledSearch(params.q ?? ""); }, [params.q]);
  const [equipment, setEquipment] = useState<string>();
  const [duration, setDuration] = useState<DurationRange>();
  const [platform, setPlatform] = useState<string>();
  const [contributor, setContributor] = useState<{ id: string; name: string }>();
  const [surprising, setSurprising] = useState(false);
  const toast = useToast();
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
  const filters: DiscoverFilters = { q: settledSearch, equipment, duration, platform, contributor: contributor?.id };
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
  const active = activeFilters(filters, contributor?.name);
  const narrowed = !!(settledSearch.trim() || active.length);
  const contributors = useQuery({
    queryKey: discoverKeys.contributors(owner, enrollment?.generation),
    queryFn: ({ signal }) => api.discoverContributors(signal),
    enabled: ready && cards.length > 0,
    staleTime: DISCOVER_STALE_MS,
    // An older API without this route just hides the strip.
    retry: false,
  });
  const people = (contributors.data ?? []).filter((person) => person.contributor_id);
  /** Every filter, including People, uses the same live sheet. */
  function clearSheetFilters() {
    setEquipment(undefined);
    setDuration(undefined);
    setPlatform(undefined);
    setContributor(undefined);
  }
  function clearFilters() {
    clearSheetFilters();
    setContributor(undefined);
  }
  async function surprise() {
    if (surprising) return;
    setSurprising(true);
    try {
      const pick = await api.discoverRandom(filters);
      router.push({ pathname: "/discover/[id]", params: { id: pick.id } });
    } catch (e) {
      const missing = (e as { status?: number }).status === 404;
      if (missing) toast(narrowed ? "Nothing matches these filters yet" : "No shared workouts yet", "info");
      else toast("Couldn’t pick a workout. Check your connection and try again.", "error");
    } finally {
      setSurprising(false);
    }
  }
  function clear() {
    setSearch("");
    setSettledSearch("");
    clearFilters();
  }
  async function refresh() {
    setPulling(true);
    try {
      const caps = await capabilities.refetch();
      if (caps.data?.discover) await Promise.all([feed.refetch(), contributors.refetch()]);
    } finally {
      setPulling(false);
    }
  }
  const open = (card: DiscoverCard) => router.push({ pathname: "/discover/[id]", params: { id: card.id } });
  async function save(card: DiscoverCard) {
    if (saveLock.current || card.saved_workout_id || !enrollment?.enrolled || enrollment.generation == null || !isCurrentAccount()) return;
    saveLock.current = true;
    setSaving(card.id);
    try {
      await api.saveDiscovered(card.id, enrollment.generation);
      if (!isCurrentAccount()) return;
      await Promise.all([cache.invalidateQueries({ queryKey: [owner, "discover"] }), cache.invalidateQueries({ queryKey: [owner, "library"] }), cache.invalidateQueries({ queryKey: [owner, "search-library"] })]);
      haptics.tick(); toast("Saved to your library");
    } catch (error) { if (isCurrentAccount()) toast((error as Error).message, "error"); }
    finally { saveLock.current = false; setSaving(undefined); }
  }
  const recent = cards.filter(card => card.published_at && new Date(card.published_at).getTime() <= Date.now() && Date.now() - new Date(card.published_at).getTime() < 7 * 86400000);
  const quick = cards.filter(card => card.estimated_minutes != null && card.estimated_minutes < 20);
  const sections: Array<{ title: string; items: DiscoverCard[]; more?: boolean }> = narrowed ? [{ title: "Results", items: cards }] : [
    ...(recent.length ? [{ title: "New this week", more: recent.length > 4, items: expandedSection === "New this week" ? recent : recent.slice(0, 4) }] : []),
    ...(quick.length ? [{ title: "Quick (under 20 min)", more: quick.length > 4, items: expandedSection === "Quick (under 20 min)" ? quick : quick.slice(0, 4) }] : []),
    { title: "All workouts", items: cards },
  ];
  const loadingFeed = capabilities.isPending || (ready && feed.isPending);
  return (
    <>
    <RouterStack.Screen options={{ headerRight: () => <BrowseHeader onMenu={() => setMenu(true)} menuItems={[
      { title: "Share yours", disabled: !enrollment?.enrolled, onPress: () => router.push("/discover/share") },
      { title: view === "grid" ? "Show workouts as a list" : "Show workouts as a grid", onPress: toggleView },
    ]} /> }} />
    <Screen
      title="Discover"
      refreshing={pulling}
      onRefresh={() => {
        void refresh();
      }}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) void feed.fetchNextPage();
      }}
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
          <BrowseLinks links={[
            { title: surprising ? "Choosing…" : "Surprise me", onPress: () => void surprise(), disabled: surprising },
            { title: "Filter", onPress: () => setFiltersOpen(true) },
          ]} />
          {(!!active.length || !!settledSearch) && <Button title={`${[settledSearch, ...active.map(f => f.label)].filter(Boolean).join(" · ")} · Clear`} variant="ghost" size="sm" onPress={clear} />}
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
                      onPress={() => router.navigate("/extract")}
                    />
                  </Row>
                }
              />
            )
          ) : (
            <>
              {sections.map(section => <View key={section.title} style={{ gap: 12 }}>
                <Row justify="space-between" wrap>
                  <Copy kind="subheading">{section.title}</Copy>
                  {section.more && <Button title={expandedSection === section.title ? "Show less" : "See all"} variant="ghost" textLink size="sm" inline onPress={() => setExpandedSection(expandedSection === section.title ? undefined : section.title)} />}
                </Row>
                {view === "list" ? <ListGroup>{section.items.map(card => <ListRow key={card.id} title={card.title} detail={[card.source_creator, platformInfo(card.source_platform).label].filter(Boolean).join(" · ")} onPress={() => open(card)} />)}</ListGroup> : <DiscoverGrid>{section.items.map(card => <DiscoverGridCard key={card.id} card={card} onPress={() => open(card)}
                  onSave={() => enrollment?.enrolled ? void save(card) : router.push("/onboarding")} saving={saving === card.id} />)}</DiscoverGrid>}
              </View>)}
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
      <Sheet visible={menu} onClose={() => setMenu(false)} title="Discover options">
        <ListRow title={view === "grid" ? "Show workouts as a list" : "Show workouts as a grid"} onPress={toggleView} />
        <Button title="Share yours" variant="ghost" disabled={!enrollment?.enrolled} onPress={() => { setMenu(false); router.push("/discover/share"); }} />
      </Sheet>
      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <Stack gap={16}>
          {!!people.length && <FilterGroup title="People">
            {people.map(person => <Chip key={person.contributor_id} role="radio" label={contributorChip(person)}
              icon="person-circle-outline" selected={contributor?.id === person.contributor_id}
              onPress={() => setContributor(contributor?.id === person.contributor_id ? undefined
                : { id: person.contributor_id!, name: person.is_you ? "you" : person.display_name })} />)}
          </FilterGroup>}
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
          <Row gap={8} wrap justify="flex-end">
            {active.length > 0 && (
              <Button
                title="Clear all"
                variant="ghost"
                inline
                onPress={clearSheetFilters}
              />
            )}
            <Button title="Show workouts" inline onPress={() => setFiltersOpen(false)} />
          </Row>
        </Stack>
      </Sheet>
    </Screen>
    </>
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

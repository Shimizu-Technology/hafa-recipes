import { BrowseHeader } from "@/components/native-tab-stack";
import { BrowseLinks, FilterSummary } from "@/components/browse-links";
import { workoutGridColumns } from "@/lib/readable-layout";
import { workoutOrigin } from "@/lib/labels";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowDimensions, ActivityIndicator, FlatList, View } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import {
  Button,
  Chip,
  ChipRow,
  Choice,
  Copy,
  Empty,
  Field,
  ListGroup,
  ListRow,
  Notice,
  Row,
  Screen,
  Sheet,
  SkeletonCard,
  haptics,
  useColors,
} from "@/components/ui";
import { LIBRARY_GRID_GAP, LibraryCard } from "@/components/library-card";
import { spacing } from "@/constants/theme";
import { useTraining } from "@/lib/context";
import { tagsFromText, addWorkoutsToCollection, type LibraryFilters } from "@/lib/organization";
import type { Workout } from "@/lib/models";
import { useLibraryView, workoutCardBadge, workoutCardMeta } from "@/lib/library-view";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

const kindIcons = { exercise: "fitness-outline", accessory: "body-outline", session: "barbell-outline", program: "calendar-outline" } as const;
const kindLabels: Record<Workout["kind"], string> = { exercise: "Exercises", accessory: "Accessory", session: "Sessions", program: "Programs" };
export default function Library() {
  const { width, fontScale } = useWindowDimensions();
  const columns = workoutGridColumns(width, fontScale);
  const c = useColors();
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const [view, setView] = useLibraryView(storage, owner);
  const [menu, setMenu] = useState(false);
  const [equipment, setEquipment] = useState("");
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState<LibraryFilters["kind"]>();
  const [favorite, setFavorite] = useState(false);
  const [archived, setArchived] = useState(false);
  const [collection, setCollection] = useState<string>();
  const [maxMinutes, setMaxMinutes] = useState<number>();
  const [needsInfo, setNeedsInfo] = useState(false);
  const [filters, setFilters] = useState(false);
  const [selecting, setSelecting] = useState(false), [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false), [bulkTarget, setBulkTarget] = useState<string>();
  const [bulkBusy, setBulkBusy] = useState(false), [bulkMessage, setBulkMessage] = useState("");
  const [bulkError, setBulkError] = useState("");
  const scope = useMemo(() => ({ lock: null as object | null }), [owner, enrollment?.generation, storage]);
  const live = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    live.current = scope;
    setSelecting(false); setSelectedIds([]); setBulkOpen(false); setBulkTarget(undefined); setBulkMessage(""); setBulkError(""); setBulkBusy(false);
    return () => { if (live.current === scope) live.current = null; };
  }, [scope]);
  function current() {
    if (live.current !== scope || !storage.isCurrent() || !isCurrentAccount())
      throw Error("Your account or training setup changed. Reopen your library before organizing.");
  }
  function interact(action: () => void) {
    try { current(); } catch { return; }
    if (!scope.lock) action();
  }
  function select(id: string) {
    if (scope.lock) return;
    try { current(); } catch { return; }
    setSelectedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
    setBulkMessage(""); setBulkError("");
  }
  function startSelecting(id?: string) {
    if (!enrollment?.enrolled || bulkBusy) return;
    interact(() => { haptics.tick(); setMenu(false); setSelecting(true); setSelectedIds(id ? [id] : []); setBulkMessage(""); setBulkError(""); });
  }
  async function addSelected() {
    if (scope.lock || !selectedIds.length || !bulkTarget || !enrollment?.generation) return;
    try { current(); } catch { return; }
    const command = { ids: [...selectedIds], target: bulkTarget, generation: enrollment.generation };
    const token = {}; scope.lock = token; setBulkBusy(true); setBulkError("");
    try {
      const result = await addWorkoutsToCollection(command.ids, command.target, command.generation, api, current);
      current();
      setSelectedIds(result.failed.map(item => item.id));
      setBulkMessage(`${result.added.length} added to the collection.${result.failed.length ? ` ${result.failed.length} ${result.failed.length === 1 ? "needs" : "need"} retry.` : ""}`);
      setBulkError(result.failed[0]?.message ?? "");
      if (!result.failed.length) { setBulkOpen(false); setSelecting(false); }
      await Promise.all([cache.invalidateQueries({ queryKey: [owner, "library"] }), cache.invalidateQueries({ queryKey: [owner, "collections"] }),
        cache.invalidateQueries({ queryKey: [owner, "organization"] }), cache.invalidateQueries({ queryKey: [owner, "workout"] })]);
      current();
    } catch (error) {
      try { current(); setBulkError(error instanceof Error ? error.message : "Could not add these workouts. Retry the remaining selection."); } catch { /* Old account views stay retired. */ }
    } finally { if (scope.lock === token) scope.lock = null; try { current(); setBulkBusy(false); } catch { /* Current scope owns its controls. */ } }
  }

  const collections = useQuery({
    queryKey: [owner, "collections", enrollment?.generation],
    queryFn: () => api.collections(enrollment?.generation ?? 0),
    enabled: !!enrollment?.enrolled,
  });
  const selected: LibraryFilters = {
    equipment: equipment.trim(),
    kind,
    favorite_only: favorite,
    archived_only: archived,
    include_archived: archived,
    collection_id: collection,
    tags: tagsFromText(tags),
    max_minutes: maxMinutes,
  };
  const all = useQuery({ queryKey: [owner, "library", "search", enrollment?.generation], queryFn: api.library, enabled: !!enrollment?.enrolled });
  const needsCount = all.data?.filter(w => w.extraction_warnings?.length).length ?? 0;
  const q = useInfiniteQuery({
    queryKey: [owner, "library", enrollment?.generation, "search", selected, needsInfo],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const page = await api.searchLibrary(selected, pageParam, enrollment?.generation ?? 0);
      if (!needsInfo) return page;
      // Needs-info is client-side; load the filtered result completely so an empty first page cannot hide matches.
      const items = [...page.items];
      let cursor = page.next_cursor;
      while (cursor) {
        const next = await api.searchLibrary(selected, cursor, enrollment?.generation ?? 0);
        items.push(...next.items); cursor = next.has_more ? next.next_cursor : null;
      }
      const matches = items.filter(w => w.extraction_warnings?.length);
      return { ...page, items: matches, total: matches.length, has_more: false, next_cursor: null };
    },
    getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    // Keep this account's results on screen while a new search loads, so typing never flashes empty.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[0] === owner && previousQuery.queryKey[2] === enrollment?.generation ? previous : undefined,
    enabled: !!enrollment?.enrolled,
  });
  // Workouts saved on another device or from a share appear without relaunching.
  // Each query refetches only once it is stale; loaded pages refetch together so the list stays consistent.
  const freshness = useFocusRefresh([q, collections, all], { enabled: !!enrollment?.enrolled });
  const visible = [
    ...new Map(q.data?.pages.flatMap((page) => page.items).map((workout) => [workout.id, workout]) ?? []).values(),
  ];
  const filterCount = [needsInfo, favorite, kind, archived, equipment.trim(), tags.trim(), collection, maxMinutes].filter(Boolean).length;
  const narrowed = !!filterCount;
  const allSelected = !!visible.length && visible.every((w) => selectedIds.includes(w.id));
  const collectionTitle = collections.data?.find((item) => item.id === collection)?.title;
  const needsLink = !archived && !!needsCount;
  // Programs and Needs info show as selected links; everything else is summarised once below them.
  const sheetFilters = [
    archived ? "Archived" : null,
    needsInfo && !needsLink ? "Needs info" : null,
    favorite ? "Favorites" : null,
    kind && kind !== "program" ? kindLabels[kind] : null,
    maxMinutes ? `Up to ${maxMinutes} min` : null,
    collectionTitle,
    equipment.trim(),
    tags.trim(),
  ].filter((item): item is string => !!item);
  function clear() {
    setNeedsInfo(false);
    setEquipment("");
    setTags("");
    setKind(undefined);
    setFavorite(false);
    setArchived(false);
    setCollection(undefined);
    setMaxMinutes(undefined);
  }
  const header = (screenHeader: ReactNode) => (
    <View style={{ gap: spacing.md, paddingBottom: spacing.xs }}>
      {screenHeader}
      {selecting ? (
        <Row justify="space-between">
          <Button title="Done" variant="ghost" size="sm" inline disabled={bulkBusy}
            onPress={() => interact(() => { setSelecting(false); setSelectedIds([]); setBulkMessage(""); setBulkError(""); })} />
          <Copy kind="label">{selectedIds.length} selected</Copy>
          <Button title={allSelected ? "Clear selection" : "Select all"} variant="ghost" size="sm" inline disabled={bulkBusy || !visible.length || q.isPlaceholderData}
            onPress={() => interact(() => { setSelectedIds(allSelected ? [] : [...new Set([...selectedIds, ...visible.map((w) => w.id)])]); setBulkMessage(""); setBulkError(""); })} />
        </Row>
      ) : <BrowseLinks links={[
        { title: "Collections", onPress: () => router.push("/collections") },
        { title: "Programs", selected: kind === "program", onPress: () => setKind(kind === "program" ? undefined : "program") },
        ...(needsLink ? [{ title: `Needs info · ${needsCount}`, selected: needsInfo, onPress: () => setNeedsInfo(!needsInfo) }] : []),
        { title: sheetFilters.length ? `Filter · ${sheetFilters.length}` : "Filter", onPress: () => setFilters(true) },
      ]} />}
      {!selecting && <FilterSummary items={sheetFilters} onClear={clear} />}
      {collections.error && <><Notice error>Could not load collections.</Notice><Button title="Retry loading collections" secondary onPress={() => void collections.refetch()} /></>}
      {!!q.error && visible.length > 0 && <>
        <Notice error>Couldn’t refresh. Showing your saved workouts.</Notice>
        <Button title="Retry loading workouts" secondary onPress={() => void q.refetch()} />
      </>}
      {!!bulkMessage && <Notice>{bulkMessage}</Notice>}
    </View>
  );
  // The list clones its empty element with layout props, so multi-part states need a real View, not a Fragment.
  const empty = q.isPending && !!enrollment?.enrolled ? (
    <View style={{ gap: spacing.md }}>
      <SkeletonCard label="Loading your workouts" />
      <SkeletonCard lines={1} label="Loading your workouts" />
    </View>
  ) : q.error ? (
    <View style={{ gap: spacing.md }}>
      <Notice error>{q.error.message}</Notice>
      <Button title="Try again" secondary onPress={() => void q.refetch()} />
    </View>
  ) : (
    <Empty
      icon="albums-outline"
      title={narrowed ? "No matching workouts" : "Build your own library"}
      description={narrowed
        ? "Try a shorter search or clear the filters."
        : "Save a workout from a link, photo or your own notes. Choose what to share as you save."}
      action={narrowed ? <Button title="Clear filters" secondary onPress={clear} /> : (
        <Button title={enrollment?.enrolled ? "Add a workout" : "Start saving workouts"} icon="add"
          onPress={() => router.push(enrollment?.enrolled ? "/capture" : "/onboarding")} />
      )}
    />
  );
  return (
    <>
    <Stack.Screen options={{ headerRight: () => <BrowseHeader add onMenu={() => setMenu(true)} menuItems={[
      { title: view === "grid" ? "Show as a list" : "Show as a grid", onPress: () => setView(view === "grid" ? "list" : "grid") },
      { title: "Select workouts", disabled: !enrollment?.enrolled || bulkBusy, onPress: () => startSelecting() },
      { title: "Manage collections", onPress: () => router.push("/collections") },
      { title: archived ? "Show active workouts" : "Show archived workouts", onPress: () => setArchived(!archived) },
    ]} /> }} />
    <Screen
      title="Library"
      refreshing={freshness.refreshing}
      onRefresh={enrollment?.enrolled ? freshness.onRefresh : undefined}
      footer={selecting ? <Button title="Add selected to collection" icon="folder-open-outline" disabled={!selectedIds.length || bulkBusy}
        onPress={() => interact(() => { setBulkTarget(collection ?? collections.data?.[0]?.id); setBulkMessage(""); setBulkError(""); setBulkOpen(true); })} /> : undefined}
      list={({ header: screenHeader, contentContainerStyle, refreshControl }) => (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          key={`${view}:${columns}`}
          data={visible}
          numColumns={view === "grid" ? columns : 1}
          keyExtractor={(w) => w.id}
          columnWrapperStyle={view === "grid" && columns > 1 ? { gap: LIBRARY_GRID_GAP } : undefined}
          contentContainerStyle={[contentContainerStyle, { rowGap: 20 }]}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={header(screenHeader)}
          ListEmptyComponent={empty}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.action} accessibilityLabel="Loading more workouts" />
            : q.isFetchNextPageError ? <Button title="Retry loading more" secondary onPress={() => void q.fetchNextPage()} /> : null}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage && !q.isPlaceholderData && !q.isFetchNextPageError) void q.fetchNextPage(); }}
          renderItem={({ item: w }) => (
            <LibraryCard
              view={view}
              title={w.title}
              meta={workoutCardMeta(w)}
              creator={w.source_creator} origin={workoutOrigin(w)}
              image={w.source_thumbnail_url}
              icon={kindIcons[w.kind]}
              favorite={!!w.organization?.favorite}
              badge={workoutCardBadge(w)}
              selected={selecting ? selectedIds.includes(w.id) : undefined}
              onPress={() => selecting ? select(w.id) : router.push({ pathname: "/workout/[id]", params: { id: w.id } })}
              onLongPress={selecting ? undefined : () => startSelecting(w.id)}
            />
          )}
        />
      )}
    >
      <Sheet visible={menu} onClose={() => setMenu(false)} title="Library options">
        <ListGroup>
          <ListRow icon={view === "grid" ? "list-outline" : "grid-outline"} title={view === "grid" ? "Show as a list" : "Show as a grid"} trailing="none"
            onPress={() => { setView(view === "grid" ? "list" : "grid"); setMenu(false); }} />
          <ListRow icon="checkmark-circle-outline" title="Select workouts" trailing="none" disabled={!enrollment?.enrolled || bulkBusy}
            onPress={() => startSelecting()} />
          <ListRow icon="folder-open-outline" title="Manage collections" onPress={() => { setMenu(false); router.push("/collections"); }} />
          <ListRow icon="archive-outline" title={archived ? "Show active workouts" : "Show archived workouts"} trailing="none"
            onPress={() => { setArchived(!archived); setMenu(false); }} />
        </ListGroup>
      </Sheet>
      <Sheet visible={filters} onClose={() => setFilters(false)} title="Filter workouts">
        <Choice label="Needs info" selected={needsInfo} onPress={() => setNeedsInfo(!needsInfo)} />
        <Choice label="Favorites only" selected={favorite} onPress={() => setFavorite(!favorite)} />
        <Copy kind="label">Workout type</Copy>
        <ChipRow wrap>
          {(["session", "exercise", "program", "accessory"] as const).map(value => <Chip key={value}
            label={kindLabels[value]} selected={kind === value} onPress={() => setKind(kind === value ? undefined : value)} />)}
        </ChipRow>
        <Copy kind="label">Time</Copy>
        <ChipRow wrap>
          {[15, 30, 45].map(value => <Chip key={value} label={`Up to ${value} min`} selected={maxMinutes === value}
            onPress={() => setMaxMinutes(maxMinutes === value ? undefined : value)} />)}
        </ChipRow>
        <Choice label="Archived workouts" selected={archived} onPress={() => setArchived(!archived)} />
        <Field label="Equipment" value={equipment} onChange={setEquipment} placeholder="Dumbbells, bodyweight…" optional />
        <Field label="Tags" value={tags} onChange={setTags} placeholder="Separate tags with commas" optional />
        {!!collections.data?.length && <Copy kind="label">Collection</Copy>}
        {!!collections.data?.length && <Choice role="radio" label="All collections" selected={!collection} onPress={() => setCollection(undefined)} />}
        {collections.data?.map((item) => (
          <Choice role="radio" key={item.id} label={item.title} detail={`${item.workout_count} workouts`}
            selected={collection === item.id} onPress={() => setCollection(item.id)} />
        ))}
        {collections.error && <Notice error>{collections.error.message}</Notice>}
        <Row gap={10}>
          <Button title="Clear filters" secondary inline onPress={clear} />
          <Button title="Show workouts" inline onPress={() => setFilters(false)} />
        </Row>
      </Sheet>
      <Sheet visible={bulkOpen} onClose={() => interact(() => setBulkOpen(false))} title="Add workouts to a collection">
        <Copy>{selectedIds.length} selected. Existing collections, favorites, tags and archive choices stay private and unchanged.</Copy>
        {collections.data?.map(item => <Choice role="radio" key={item.id} label={item.title} selected={bulkTarget === item.id} disabled={bulkBusy}
          onPress={() => interact(() => { setBulkTarget(item.id); setBulkMessage(""); setBulkError(""); })} />)}
        {!collections.data?.length && <Button title="Create a collection" secondary disabled={bulkBusy} onPress={() => interact(() => { setBulkOpen(false); router.push("/collections"); })} />}
        {!!q.error && visible.length > 0 && <>
        <Notice error>Couldn’t refresh. Showing your saved workouts.</Notice>
        <Button title="Retry loading workouts" secondary onPress={() => void q.refetch()} />
      </>}
      {!!bulkMessage && <Notice>{bulkMessage}</Notice>}
        {!!bulkError && <Notice error>{bulkError} Only the remaining selected workouts will be retried.</Notice>}
        <Button title={bulkError ? "Retry remaining workouts" : "Add to collection"} busy={bulkBusy} disabled={!bulkTarget || !selectedIds.length}
          onPress={() => void addSelected()} />
        <Button title="Keep selecting" secondary disabled={bulkBusy} onPress={() => interact(() => setBulkOpen(false))} />
      </Sheet>
    </Screen>
    </>
  );
}

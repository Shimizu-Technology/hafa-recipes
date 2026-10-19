import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  AccountButton,
  Button,
  Card,
  Chip,
  ChipRow,
  Choice,
  Copy,
  Empty,
  Field,
  IconButton,
  ListRow,
  MediaCard,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonCard,
} from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining, useOfflineTraining } from "@/lib/context";
import { tagsFromText, addWorkoutsToCollection, type LibraryFilters } from "@/lib/organization";
import type { Workout } from "@/lib/models";
import { workoutOriginLabel } from "@/lib/workout-presentation";
import { WorkoutGallery, useWorkoutGalleryColumns } from "@/components/workout-gallery";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

const kindIcons = { exercise: "fitness-outline", accessory: "body-outline", session: "barbell-outline", program: "calendar-outline" } as const;
const kindLabels: Record<Workout["kind"], string> = { exercise: "Exercises", accessory: "Accessory", session: "Sessions", program: "Programs" };
export default function Library() {
  const columns = useWorkoutGalleryColumns();
  const { state: training, ready: trainingReady } = useOfflineTraining();
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [equipment, setEquipment] = useState("");
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState<LibraryFilters["kind"]>();
  const [favorite, setFavorite] = useState(false);
  const [archived, setArchived] = useState(false);
  const [collection, setCollection] = useState<string>();
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

  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const collections = useQuery({
    queryKey: [owner, "collections", enrollment?.generation],
    queryFn: () => api.collections(enrollment?.generation ?? 0),
    enabled: !!enrollment?.enrolled,
  });
  const selected: LibraryFilters = {
    q: settledSearch.trim(),
    equipment: equipment.trim(),
    kind,
    favorite_only: favorite,
    archived_only: archived,
    include_archived: archived,
    collection_id: collection,
    tags: tagsFromText(tags),
  };
  const q = useInfiniteQuery({
    queryKey: [owner, "library", enrollment?.generation, "search", selected],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.searchLibrary(selected, pageParam, enrollment?.generation ?? 0),
    getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    enabled: !!enrollment?.enrolled,
  });
  // Workouts saved on another device or from a share appear without relaunching.
  // Each query refetches only once it is stale; loaded pages refetch together so the list stays consistent.
  const freshness = useFocusRefresh([q, collections], { enabled: !!enrollment?.enrolled });
  const visible = [
    ...new Map(q.data?.pages.flatMap((page) => page.items).map((workout) => [workout.id, workout]) ?? []).values(),
  ];
  const narrowed = search || equipment || tags || kind || favorite || archived || collection;
  const advanced = [equipment, tags, collection].filter(Boolean).length;
  function clear() {
    setSearch("");
    setEquipment("");
    setTags("");
    setKind(undefined);
    setFavorite(false);
    setArchived(false);
    setCollection(undefined);
  }
  return (
    <Screen
      title="Your library"
      subtitle="All your workouts, in one place."
      refreshing={freshness.refreshing}
      onRefresh={enrollment?.enrolled ? freshness.onRefresh : undefined}
      action={
        <Row gap={8}>
          <IconButton
            icon="add"
            label="Add a workout"
            variant="primary"
            onPress={() => router.push(enrollment?.enrolled ? "/capture" : "/onboarding")}
          />
          <AccountButton />
        </Row>
      }
    >
      {trainingReady && training.active && <Card compact>
        <Copy kind="caption" tone="accent">Session in progress</Copy>
        <Copy kind="subheading">{training.active.workout.title}</Copy>
        <Button title="Resume session" secondary icon="play-outline" onPress={() => router.push("/training")} />
      </Card>}
      <Field label="Search workouts" value={search} onChange={setSearch} placeholder="Title or training focus" />
      <ChipRow label="Quick filters">
        <Chip label="Favorites" icon="heart-outline" selected={favorite} onPress={() => setFavorite(!favorite)} />
        {!!kind && <Chip label={kindLabels[kind]} selected onPress={() => setKind(undefined)} />}
        {archived && <Chip label="Archived" selected onPress={() => setArchived(false)} />}
        <Chip label={advanced || kind || archived ? "Filters · active" : "Filters"} icon="options-outline"
          selected={!!(advanced || kind || archived)} onPress={() => setFilters(true)} />
      </ChipRow>
      {!!collections.data?.length && <ChipRow label="Collections">
        <Chip label="All workouts" selected={!collection} onPress={() => setCollection(undefined)} />
        {collections.data.map(item => <Chip key={item.id} label={item.title} selected={collection === item.id} onPress={() => setCollection(item.id)} />)}
      </ChipRow>}
      {collections.error && <><Notice error>Could not load collections.</Notice><Button title="Retry loading collections" secondary onPress={() => void collections.refetch()} /></>}
      {selecting && <>
        <Copy kind="small">{selectedIds.length} selected across your library</Copy>
        <Button title="Add selected to collection" icon="folder-open-outline" secondary disabled={!selectedIds.length || bulkBusy}
          onPress={() => interact(() => { setBulkTarget(collection ?? collections.data?.[0]?.id); setBulkMessage(""); setBulkError(""); setBulkOpen(true); })} />
      </>}
      {!!bulkMessage && <Notice>{bulkMessage}</Notice>}
      <Row gap={10} wrap>
        <Button title="Manage collections" icon="folder-open-outline" variant="ghost" size="sm" inline onPress={() => router.push("/collections")} />
        <Button title={selecting ? "Done selecting" : "Select workouts"} variant="ghost" size="sm" inline disabled={bulkBusy || !enrollment?.enrolled}
          onPress={() => interact(() => { setSelecting(!selecting); setSelectedIds([]); setBulkMessage(""); setBulkError(""); })} />
      </Row>
      <QueryState
        loading={false}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {q.isPending && !!enrollment?.enrolled ? (
          <>
            <SkeletonCard label="Loading your workouts" />
            <SkeletonCard lines={1} label="Loading your workouts" />
          </>
        ) : !visible.length ? (
          <Empty
            icon="albums-outline"
            title={narrowed ? "No matching workouts" : "Build your own library"}
            description={
              narrowed
                ? "Try a shorter search or clear the filters."
                : "Save a workout from a link, photo or your own notes. Choose what to share as you save."
            }
            action={
              narrowed ? (
                <Button title="Clear filters" secondary onPress={clear} />
              ) : (
                <Button title={enrollment?.enrolled ? "Add a workout" : "Start saving workouts"} icon="add"
                  onPress={() => router.push(enrollment?.enrolled ? "/capture" : "/onboarding")} />
              )
            }
          />
        ) : (
          <>
            <SectionHeader title={`${q.data?.pages[0].total ?? visible.length} ${archived ? "archived " : ""}${q.data?.pages[0].total === 1 ? "workout" : "workouts"}`} />
            <WorkoutGallery>
            {visible.map((w) => selecting ? <Choice key={w.id} label={w.title} detail={w.source_creator ? `By ${w.source_creator}` : w.kind}
              selected={selectedIds.includes(w.id)} disabled={bulkBusy} onPress={() => select(w.id)} /> : (
              <MediaCard
                key={w.id}
                layout={columns === 2 ? "stacked" : "row"}
                title={w.title}
                image={w.source_thumbnail_url}
                icon={kindIcons[w.kind]}
                badge={w.extraction_warnings?.length ? "Check details" : w.organization?.favorite ? "Favorite" : undefined}
                footer={w.source_creator ? <Copy kind="small" tone="muted">By {w.source_creator}</Copy> : undefined}
                meta={[
                  w.kind,
                  workoutOriginLabel(w),
                  ...(w.organization?.tags ?? []),
                ].join(" · ")}
                chips={w.equipment_required ?? []}
                accessibilityLabel={`View workout ${w.title}`}
                onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })}
              />
            ))}
            </WorkoutGallery>
            {q.hasNextPage && (
              <Button
                title="Load more workouts"
                secondary
                busy={q.isFetchingNextPage}
                onPress={() => {
                  void q.fetchNextPage();
                }}
              />
            )}
          </>
        )}
      </QueryState>
      <Sheet visible={filters} onClose={() => setFilters(false)} title="Find your next session">
        <Copy kind="label">Workout type</Copy>
        <ChipRow wrap>
          {(["session", "exercise", "program", "accessory"] as const).map(value => <Chip key={value}
            label={kindLabels[value]} selected={kind === value} onPress={() => setKind(kind === value ? undefined : value)} />)}
        </ChipRow>
        <Choice label="Archived workouts" selected={archived} onPress={() => setArchived(!archived)} />
        <Field
          label="Equipment filter"
          value={equipment}
          onChange={setEquipment}
          placeholder="Dumbbells, bodyweight…"
          optional
        />
        <Field label="Tag filter" value={tags} onChange={setTags} placeholder="Separate tags with commas" optional />
        <Copy kind="label">Collection</Copy>
        <Choice label="All collections" selected={!collection} onPress={() => setCollection(undefined)} />
        {collections.data?.map((item) => (
          <Choice
            key={item.id}
            label={item.title}
            detail={`${item.workout_count} workouts`}
            selected={collection === item.id}
            onPress={() => setCollection(item.id)}
          />
        ))}
        {collections.error && <Notice error>{collections.error.message}</Notice>}
        <ListRow
          icon="folder-open-outline"
          title="Manage collections"
          onPress={() => {
            setFilters(false);
            router.push("/collections");
          }}
        />
        <Row gap={10}>
          <Button title="Clear filters" secondary inline onPress={clear} />
          <Button title="Show workouts" inline onPress={() => setFilters(false)} />
        </Row>
      </Sheet>
      <Sheet visible={bulkOpen} onClose={() => interact(() => setBulkOpen(false))} title="Add workouts to a collection">
        <Copy>{selectedIds.length} selected. Existing collections, favorites, tags and archive choices stay private and unchanged.</Copy>
        {collections.data?.map(item => <Choice key={item.id} label={item.title} selected={bulkTarget === item.id} disabled={bulkBusy}
          onPress={() => interact(() => { setBulkTarget(item.id); setBulkMessage(""); setBulkError(""); })} />)}
        {!collections.data?.length && <Button title="Create a collection" secondary disabled={bulkBusy} onPress={() => interact(() => { setBulkOpen(false); router.push("/collections"); })} />}
        {!!bulkMessage && <Notice>{bulkMessage}</Notice>}
        {!!bulkError && <Notice error>{bulkError} Only the remaining selected workouts will be retried.</Notice>}
        <Button title={bulkError ? "Retry remaining workouts" : "Add to collection"} busy={bulkBusy} disabled={!bulkTarget || !selectedIds.length}
          onPress={() => void addSelected()} />
        <Button title="Keep selecting" secondary disabled={bulkBusy} onPress={() => interact(() => setBulkOpen(false))} />
      </Sheet>
    </Screen>
  );
}

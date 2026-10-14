import { ImportList } from "@/components/import-list";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  AccountButton,
  Button,
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
  Sheet,
  SkeletonCard,
} from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { tagsFromText, type LibraryFilters } from "@/lib/organization";
import type { Workout } from "@/lib/models";

const kindIcons = { exercise: "fitness-outline", accessory: "body-outline", session: "barbell-outline", program: "calendar-outline" } as const;
const kindLabels: Record<Workout["kind"], string> = { exercise: "Exercises", accessory: "Accessory", session: "Sessions", program: "Programs" };
export default function Library() {
  const { api, owner, enrollment } = useTraining();
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [equipment, setEquipment] = useState("");
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState<LibraryFilters["kind"]>();
  const [favorite, setFavorite] = useState(false);
  const [archived, setArchived] = useState(false);
  const [collection, setCollection] = useState<string>();
  const [filters, setFilters] = useState(false);
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
      title="Your library."
      subtitle="Workouts you’ve saved, ready when you are."
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
      <Field label="Search workouts" value={search} onChange={setSearch} placeholder="Title or training focus" />
      <ChipRow label="Quick filters">
        <Chip label="Favorites" icon="heart-outline" selected={favorite} onPress={() => setFavorite(!favorite)} />
        {(["session", "exercise", "program", "accessory"] as const).map((value) => (
          <Chip key={value} label={kindLabels[value]} selected={kind === value} onPress={() => setKind(kind === value ? undefined : value)} />
        ))}
        <Chip label="Archived" icon="archive-outline" selected={archived} onPress={() => setArchived(!archived)} />
        <Chip
          label={advanced ? `More filters · ${advanced}` : "More filters"}
          icon="options-outline"
          selected={!!advanced}
          onPress={() => setFilters(true)}
        />
      </ChipRow>
      <ImportList />
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
                : "Save a favorite session to get started. Workouts are private until you choose to share them."
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
            <Copy kind="small" tone="muted">
              {q.data?.pages[0].total} {archived ? "archived " : ""}workouts · {visible.length} shown
            </Copy>
            {visible.map((w) => (
              <MediaCard
                key={w.id}
                title={w.title}
                image={w.source_thumbnail_url}
                icon={kindIcons[w.kind]}
                badge={w.extraction_warnings?.length ? "Check details" : w.organization?.favorite ? "Favorite" : undefined}
                footer={w.source_creator ? <Copy kind="small" tone="muted">By {w.source_creator}</Copy> : undefined}
                meta={[
                  w.kind,
                  w.provenance === "suggestion" ? "suggested" : w.provenance === "source" ? "from a source" : "your workout",
                  ...(w.organization?.tags ?? []),
                ].join(" · ")}
                chips={w.equipment_required ?? []}
                accessibilityLabel={`View workout ${w.title}`}
                onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })}
              />
            ))}
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
    </Screen>
  );
}

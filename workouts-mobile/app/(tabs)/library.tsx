import { ImportList } from "@/components/import-list";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { AccountButton, Button, Card, Choice, Copy, Empty, Field, Notice, Screen, useColors } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { tagsFromText, type LibraryFilters } from "@/lib/organization";
export default function Library() {
  const { api, owner, enrollment } = useTraining();
  const c = useColors();
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
  return (
    <Screen
      title={"Your inspiration,\norganized."}
      subtitle="A private home for the workouts you want to use."
      action={<AccountButton />}
    >
      <Button
        title="Add a workout"
        disabled={!enrollment?.enrolled}
        icon="add"
        onPress={() => router.push("/capture")}
      />
      <Field label="Search workouts" value={search} onChange={setSearch} placeholder="Title or training focus" />
      <ImportList />
      <Button title={filters ? "Hide filters" : "Filter workouts"} secondary onPress={() => setFilters(!filters)} />
      {filters && (
        <Card>
          <Copy kind="heading">Find your next session</Copy>
          <Choice label="Favorites only" selected={favorite} onPress={() => setFavorite(!favorite)} />
          <Choice
            label="Archived workouts"
            detail="Archived items stay saved and out of the default library."
            selected={archived}
            onPress={() => setArchived(!archived)}
          />
          <Choice label="All workout types" selected={!kind} onPress={() => setKind(undefined)} />
          {(["exercise", "accessory", "session", "program"] as const).map((value) => (
            <Choice key={value} label={value} selected={kind === value} onPress={() => setKind(value)} />
          ))}
          <Field
            label="Equipment filter"
            value={equipment}
            onChange={setEquipment}
            placeholder="Dumbbells, bodyweight…"
            optional
          />
          <Field label="Tag filter" value={tags} onChange={setTags} placeholder="Separate tags with commas" optional />
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
          <Button title="Manage collections" secondary onPress={() => router.push("/collections")} />
          <Button
            title="Clear filters"
            secondary
            onPress={() => {
              setSearch("");
              setEquipment("");
              setTags("");
              setKind(undefined);
              setFavorite(false);
              setArchived(false);
              setCollection(undefined);
            }}
          />
        </Card>
      )}
      <QueryState
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {!visible.length ? (
          <Empty
            icon="albums-outline"
            title={narrowed ? "No matching workouts" : "Build your own library"}
            description={
              narrowed
                ? "Try a shorter search or clear the filters."
                : "Save a favorite session to get started. Workouts are private until you choose to share them."
            }
          />
        ) : (
          <>
            <Copy kind="small" color={c.muted}>
              {q.data?.pages[0].total} {archived ? "archived " : ""}workouts · {visible.length} shown
            </Copy>
            {visible.map((w) => (
              <Card key={w.id}>
                <Copy kind="small" color={c.muted}>
                  {w.kind.toUpperCase()} · {w.organization?.favorite ? "FAVORITE · " : ""}
                  {w.provenance === "suggestion"
                    ? "SUGGESTED"
                    : w.provenance === "source"
                      ? "FROM A SOURCE"
                      : "YOUR WORKOUT"}
                </Copy>
                <Copy kind="heading">{w.title}</Copy>
                {!!w.equipment_required?.length && <Copy color={c.muted}>{w.equipment_required.join(" · ")}</Copy>}
                {!!w.organization?.tags.length && <Copy kind="small">{w.organization.tags.join(" · ")}</Copy>}
                <Button
                  title="View workout"
                  secondary
                  onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })}
                />
              </Card>
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
    </Screen>
  );
}

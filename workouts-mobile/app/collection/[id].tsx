import { workoutGridColumns } from "@/lib/readable-layout";
import { workoutOrigin } from "@/lib/labels";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowDimensions, ActivityIndicator, FlatList, View } from "react-native";
import { hashKey, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Copy, Empty, Field, IconButton, ListGroup, ListRow, Notice, Row, Screen, Sheet, SkeletonCard, useColors } from "@/components/ui";
import { LIBRARY_GRID_GAP, LibraryCard } from "@/components/library-card";
import { spacing } from "@/constants/theme";
import { useTraining } from "@/lib/context";
import { collectionTitleError, type LibraryFilters } from "@/lib/organization";
import { useLibraryView, workoutCardBadge, workoutCardMeta, workoutCountLabel } from "@/lib/library-view";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

const kindIcons = { exercise: "fitness-outline", accessory: "body-outline", session: "barbell-outline", program: "calendar-outline" } as const;
export default function CollectionDetail() {
  const { width, fontScale } = useWindowDimensions();
  const columns = workoutGridColumns(width, fontScale);
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const cache = useQueryClient();
  const [view, setView] = useLibraryView(storage, owner);
  const [menu, setMenu] = useState(false), [renaming, setRenaming] = useState(false), [removing, setRemoving] = useState(false), [removed, setRemoved] = useState(false);
  const [title, setTitle] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const scope = useMemo(() => ({ lock: null as object | null }), [owner, generation, storage, id]);
  const live = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    live.current = scope; setRenaming(false); setRemoving(false); setBusy(false); setError("");
    return () => { if (live.current === scope) live.current = null; };
  }, [scope]);
  const current = () => live.current === scope && !!enrollment?.enrolled && storage.isCurrent() && isCurrentAccount();
  const collections = useQuery({
    queryKey: [owner, "collections", enrollment?.generation],
    queryFn: () => api.collections(generation),
    enabled: !!enrollment?.enrolled,
  });
  const item = collections.data?.find((value) => value.id === id);
  const filters: LibraryFilters = { collection_id: id };
  const searchKey = [owner, "library", enrollment?.generation, "search", filters];
  const q = useInfiniteQuery({
    queryKey: searchKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.searchLibrary(filters, pageParam, generation),
    getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    enabled: !!enrollment?.enrolled && !!item && !removed,
  });
  const freshness = useFocusRefresh([q, collections], { enabled: !!enrollment?.enrolled });
  const visible = [...new Map(q.data?.pages.flatMap((page) => page.items).map((w) => [w.id, w]) ?? []).values()];
  const gone = collections.isSuccess && !item && !removed;

  /** One collection write at a time, fenced to this account and collection. */
  async function run(work: () => Promise<unknown>, done?: () => void) {
    if (!current() || scope.lock) return false;
    const token = {}; scope.lock = token; setBusy(true); setError("");
    try {
      await work();
      if (!current()) return false;
      done?.();
      // Refresh shared lists even after `done` leaves this screen, while the account is unchanged.
      if (!storage.isCurrent() || !isCurrentAccount()) return false;
      await Promise.all([cache.invalidateQueries({ queryKey: [owner, "collections"] }), // This collection's own workouts don't change when it is renamed or removed.
        cache.invalidateQueries({ queryKey: [owner, "library"], predicate: (query) => query.queryHash !== hashKey(searchKey) }),
        cache.invalidateQueries({ queryKey: [owner, "organization"] })]);
      return current();
    } catch (e) {
      if (current()) { setError(e instanceof Error ? e.message : "Could not update this collection."); void collections.refetch(); }
      return false;
    } finally {
      if (scope.lock === token) { scope.lock = null; if (current()) setBusy(false); }
    }
  }
  async function rename() {
    if (!item) return;
    const problem = collectionTitleError(title);
    if (problem) { setError(problem); return; }
    const submitted = { title: title.trim(), revision: item.revision };
    if (await run(() => api.renameCollection(item.id, submitted.title, submitted.revision, generation))) setRenaming(false);
  }
  async function remove() {
    if (!item) return;
    const revision = item.revision;
    // Leave before refreshing so this screen never flashes "removed" or searches a deleted collection.
    await run(() => api.removeCollection(item.id, revision, generation), () => {
      setRemoved(true);
      setRemoving(false);
      if (router.canGoBack()) router.back(); else router.replace("/(tabs)/library");
    });
  }
  const header = (screenHeader: ReactNode) => (
    <View style={{ gap: spacing.md, paddingBottom: spacing.xs }}>
      {screenHeader}
      {!!q.data && <Copy tone="muted">{workoutCountLabel(q.data.pages[0].total)}</Copy>}
    </View>
  );
  const empty = gone ? (
    <Empty icon="folder-open-outline" title="This collection was removed" description="Its workouts are still in your library."
      action={<Button title="Open your library" secondary onPress={() => router.replace("/(tabs)/library")} />} />
  ) : collections.error || q.error ? (
    <View style={{ gap: spacing.md }}>
      <Notice error>{(collections.error ?? q.error)!.message}</Notice>
      <Button title="Try again" secondary onPress={() => void (collections.error ? collections.refetch() : q.refetch())} />
    </View>
  ) : !q.data ? (
    <SkeletonCard label="Loading this collection" />
  ) : (
    <Empty icon="albums-outline" title="Nothing here yet"
      description="In your Library, long-press workouts to select them, then add them to this collection."
      action={<Button title="Open your library" secondary onPress={() => router.replace("/(tabs)/library")} />} />
  );
  return (
    <Screen
      back
      title={item?.title ?? "Collection"}
      refreshing={freshness.refreshing}
      onRefresh={enrollment?.enrolled ? freshness.onRefresh : undefined}
      action={item ? <IconButton icon="ellipsis-horizontal" label="Collection options" onPress={() => setMenu(true)} /> : undefined}
      list={({ header: screenHeader, contentContainerStyle, refreshControl }) => (
        <FlatList
          key={`${view}:${columns}`}
          data={visible}
          numColumns={view === "grid" ? columns : 1}
          keyExtractor={(w) => w.id}
          columnWrapperStyle={view === "grid" && columns > 1 ? { gap: LIBRARY_GRID_GAP } : undefined}
          contentContainerStyle={[contentContainerStyle, { gap: LIBRARY_GRID_GAP }]}
          refreshControl={refreshControl}
          ListHeaderComponent={header(screenHeader)}
          ListEmptyComponent={empty}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.action} accessibilityLabel="Loading more workouts" />
            : q.isFetchNextPageError ? <Button title="Retry loading more" secondary onPress={() => void q.fetchNextPage()} /> : null}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage && !q.isFetchNextPageError) void q.fetchNextPage(); }}
          renderItem={({ item: w }) => (
            <LibraryCard view={view} title={w.title} meta={workoutCardMeta(w)} creator={w.source_creator} origin={workoutOrigin(w)}
              image={w.source_thumbnail_url} icon={kindIcons[w.kind]} favorite={!!w.organization?.favorite} badge={workoutCardBadge(w)}
              onPress={() => router.push({ pathname: "/workout/[id]", params: { id: w.id } })} />
          )}
        />
      )}
    >
      <Sheet visible={menu} onClose={() => setMenu(false)} title="Collection options">
        <ListGroup>
          <ListRow icon={view === "grid" ? "list-outline" : "grid-outline"} title={view === "grid" ? "Show as a list" : "Show as a grid"} trailing="none"
            onPress={() => { setView(view === "grid" ? "list" : "grid"); setMenu(false); }} />
          <ListRow icon="create-outline" title="Rename collection" trailing="none" disabled={busy}
            onPress={() => { setMenu(false); setTitle(item?.title ?? ""); setError(""); setRenaming(true); }} />
          <ListRow icon="trash-outline" title="Remove collection" trailing="none" destructive disabled={busy}
            onPress={() => { setMenu(false); setError(""); setRemoving(true); }} />
        </ListGroup>
      </Sheet>
      <Sheet visible={renaming} onClose={() => { if (!busy) setRenaming(false); }} title="Rename collection">
        <Field label="Collection name" value={title} onChange={(value) => { if (!busy) setTitle(value); }} placeholder="Gym days, Basketball prep…" />
        {!!error && <Notice error>{error}</Notice>}
        <Button title="Save name" busy={busy} disabled={!title.trim() || title.trim() === item?.title} onPress={() => void rename()} />
      </Sheet>
      <Sheet visible={removing} onClose={() => { if (!busy) setRemoving(false); }} title="Remove collection?">
        <Copy>Remove “{item?.title}”? Its workouts stay in your library.</Copy>
        {!!error && <Notice error>{error}</Notice>}
        <Row gap={10}>
          <Button title="Keep it" secondary inline disabled={busy} onPress={() => setRemoving(false)} />
          <Button title="Remove collection" variant="destructive" inline busy={busy} onPress={() => void remove()} />
        </Row>
      </Sheet>
    </Screen>
  );
}

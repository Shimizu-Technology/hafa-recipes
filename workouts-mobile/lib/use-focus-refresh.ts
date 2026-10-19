import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

/** Matches the app-wide query staleTime: only stale data is refetched on focus or foreground. */
export const FOCUS_REFRESH_AFTER_MS = 30_000;

interface RefreshableQuery {
  refetch(): Promise<unknown>;
  /** 0 until the query first loads. */
  dataUpdatedAt: number;
}

/**
 * Keeps a tab's data fresh: when the screen regains focus or the app comes
 * back to the foreground, each query whose data is stale refetches on its own.
 * Pull-to-refresh refetches every query.
 */
export function useFocusRefresh(
  queries: RefreshableQuery[],
  { enabled, staleAfterMs = FOCUS_REFRESH_AFTER_MS }: { enabled: boolean; staleAfterMs?: number }
) {
  // Read each query's freshness during render: React Query only re-renders for
  // result properties a render used, so a later read could see an old timestamp.
  const current = queries.map((query) => ({ refetch: query.refetch, dataUpdatedAt: query.dataUpdatedAt }));
  const latest = useRef({ queries: current, enabled });
  // Only committed renders update what focus, foreground and pull handlers read.
  useLayoutEffect(() => {
    latest.current = { queries: current, enabled };
  });
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const refreshStale = useCallback(() => {
    const { queries, enabled } = latest.current;
    if (!enabled) return;
    const now = Date.now();
    for (const query of queries)
      if (query.dataUpdatedAt > 0 && now - query.dataUpdatedAt >= staleAfterMs) void query.refetch();
  }, [staleAfterMs]);
  useFocusEffect(refreshStale);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshStale();
    });
    return () => subscription.remove();
  }, [refreshStale]);
  const onRefresh = useCallback(() => {
    const { queries, enabled } = latest.current;
    if (!enabled) return;
    setRefreshing(true);
    void Promise.all(queries.map((query) => query.refetch())).finally(() => { if (mounted.current) setRefreshing(false); });
  }, []);
  return { refreshing, onRefresh };
}

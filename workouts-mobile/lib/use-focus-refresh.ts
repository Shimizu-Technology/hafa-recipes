import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

/** Matches the app-wide query staleTime: only stale data is refetched on focus or foreground. */
export const FOCUS_REFRESH_AFTER_MS = 30_000;

/**
 * Keeps a tab's data fresh: refetches when the screen regains focus or the app
 * comes back to the foreground (only once its data is stale),
 * and drives pull-to-refresh.
 */
export function useFocusRefresh(
  refresh: () => Promise<unknown>,
  { enabled, updatedAt, staleAfterMs = FOCUS_REFRESH_AFTER_MS }: { enabled: boolean; updatedAt: number; staleAfterMs?: number }
) {
  const latest = useRef({ refresh, enabled, updatedAt });
  latest.current = { refresh, enabled, updatedAt };
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const refreshIfStale = useCallback(() => {
    const { refresh, enabled, updatedAt } = latest.current;
    if (enabled && updatedAt > 0 && Date.now() - updatedAt >= staleAfterMs) void refresh();
  }, [staleAfterMs]);
  useFocusEffect(refreshIfStale);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshIfStale();
    });
    return () => subscription.remove();
  }, [refreshIfStale]);
  const onRefresh = useCallback(() => {
    if (!latest.current.enabled) return;
    setRefreshing(true);
    void latest.current.refresh().finally(() => { if (mounted.current) setRefreshing(false); });
  }, []);
  return { refreshing, onRefresh };
}

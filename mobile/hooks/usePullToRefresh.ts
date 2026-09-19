import { useCallback, useRef, useState } from 'react';

/** Keep the native pull indicator exclusive to a user-initiated refresh. */
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const inFlight = useRef(false);

  const onPullRefresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPullRefreshing(true);
    try {
      await refresh();
    } finally {
      inFlight.current = false;
      setIsPullRefreshing(false);
    }
  }, [refresh]);

  return { isPullRefreshing, onPullRefresh };
}

import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { usePullToRefresh } from './usePullToRefresh';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('usePullToRefresh', () => {
  it('shows the pull indicator only while the user-requested fetch runs', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    let current!: ReturnType<typeof usePullToRefresh>;
    function Harness() {
      current = usePullToRefresh(refresh);
      return null;
    }

    const renderer = createRoot();
    try {
      await act(async () => renderer.render(React.createElement(Harness)));
      expect(current.isPullRefreshing).toBe(false);

      act(() => { void current.onPullRefresh(); });
      expect(current.isPullRefreshing).toBe(true);
      act(() => { void current.onPullRefresh(); });
      expect(refresh).toHaveBeenCalledTimes(1);

      await act(async () => { finish(); });
      expect(current.isPullRefreshing).toBe(false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

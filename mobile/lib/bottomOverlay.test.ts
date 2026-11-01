import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/CookTimerRunning', () => ({ useCookTimerRunning: () => false }));

import {
  DOCKED_TIMER_HEIGHT,
  OVERLAY_GAP,
  cookTimerPlacement,
  isTabRoute,
  overlayBottom,
  reportTabScreenBottomInset,
  scrollEndPadding,
  useTabScreenBottomInset,
} from './bottomOverlay';

describe('bottom overlay placement', () => {
  it('treats only the tab group as showing the native tab bar', () => {
    expect(isTabRoute(['(tabs)', 'recipes'])).toBe(true);
    expect(isTabRoute(['recipe', '[id]'])).toBe(false);
    expect(isTabRoute([])).toBe(false);
  });

  it('floats above the reported tab bar inside tabs', () => {
    // 56pt Håfa bar + 34pt home indicator.
    expect(overlayBottom({ inTabs: true, tabInset: 90, windowInset: 34, clearance: 80 })).toBe(90 + OVERLAY_GAP);
    // A docked timer pill stacks under the toast.
    expect(overlayBottom({ inTabs: true, tabInset: 83, windowInset: 34, clearance: 80, stacked: 52 })).toBe(83 + OVERLAY_GAP + 52);
  });

  it('keeps the screen clearance outside tabs and before any tab inset is known', () => {
    expect(overlayBottom({ inTabs: false, tabInset: 83, windowInset: 34, clearance: 80 })).toBe(114);
    expect(overlayBottom({ inTabs: true, tabInset: 0, windowInset: 34, clearance: 80 })).toBe(114);
  });

  it('docks a running cook timer above the tab bar on every OS and under the header elsewhere', () => {
    expect(cookTimerPlacement({ running: false, inTabs: true })).toBe('hidden');
    expect(cookTimerPlacement({ running: true, inTabs: true })).toBe('dock');
    expect(cookTimerPlacement({ running: true, inTabs: false })).toBe('top');
  });

  it('pads tab lists only for their own spacing and a docked timer', () => {
    expect(scrollEndPadding(32)).toBe(32);
    expect(scrollEndPadding(32, true)).toBe(32 + DOCKED_TIMER_HEIGHT + OVERLAY_GAP);
  });

  it('ignores empty insets from tab screens that are not on screen', async () => {
    let seen = -1;
    function Probe() { seen = useTabScreenBottomInset(); return null; }
    const root = createRoot();
    try {
      reportTabScreenBottomInset(83);
      reportTabScreenBottomInset(0);
      await act(async () => root.render(React.createElement(Probe)));
      expect(seen).toBe(83);
    } finally { await act(async () => root.unmount()); }
  });
});

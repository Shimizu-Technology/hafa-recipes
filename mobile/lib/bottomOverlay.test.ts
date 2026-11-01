import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: '18.5' } }));

import {
  OVERLAY_GAP,
  cookTimerPlacement,
  isTabRoute,
  overlayBottom,
  reportTabScreenBottomInset,
  supportsTabBottomAccessory,
  useTabScreenBottomInset,
} from './bottomOverlay';

describe('bottom overlay placement', () => {
  it('treats only the tab group as showing the native tab bar', () => {
    expect(isTabRoute(['(tabs)', 'recipes'])).toBe(true);
    expect(isTabRoute(['recipe', '[id]'])).toBe(false);
    expect(isTabRoute([])).toBe(false);
  });

  it('floats above the measured tab bar inside tabs instead of a fixed JS tab bar height', () => {
    // iOS 18 full-width bar: 49pt bar + 34pt home indicator.
    expect(overlayBottom({ inTabs: true, tabInset: 83, windowInset: 34, clearance: 80 })).toBe(83 + OVERLAY_GAP);
    // iOS 26 floating bar with a bottom accessory reports a taller inset.
    expect(overlayBottom({ inTabs: true, tabInset: 140, windowInset: 34, clearance: 80 })).toBe(140 + OVERLAY_GAP);
    // A docked timer pill stacks under the toast.
    expect(overlayBottom({ inTabs: true, tabInset: 83, windowInset: 34, clearance: 80, stacked: 52 })).toBe(83 + OVERLAY_GAP + 52);
  });

  it('keeps the screen clearance outside tabs and before any tab inset is known', () => {
    expect(overlayBottom({ inTabs: false, tabInset: 83, windowInset: 34, clearance: 80 })).toBe(114);
    expect(overlayBottom({ inTabs: true, tabInset: 0, windowInset: 34, clearance: 80 })).toBe(114);
  });

  it('puts the cook timer in the native accessory on iOS 26 tabs and docks it on older tab bars', () => {
    expect(cookTimerPlacement({ running: false, inTabs: true, supportsAccessory: true })).toBe('hidden');
    expect(cookTimerPlacement({ running: true, inTabs: true, supportsAccessory: true })).toBe('accessory');
    expect(cookTimerPlacement({ running: true, inTabs: true, supportsAccessory: false })).toBe('dock');
    expect(cookTimerPlacement({ running: true, inTabs: false, supportsAccessory: true })).toBe('top');
    expect(supportsTabBottomAccessory).toBe(false);
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

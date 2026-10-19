import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { listEntranceDelay, MAX_LIST_ENTRANCE_DELAY_MS, useInitialListEntrance } from './listAnimation';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('listEntranceDelay', () => {
  it('stages the first visible items and caps later cells', () => {
    expect(listEntranceDelay(0, 40)).toBe(0);
    expect(listEntranceDelay(3, 40)).toBe(120);
    expect(listEntranceDelay(40, 40)).toBe(MAX_LIST_ENTRANCE_DELAY_MS);
    expect(listEntranceDelay(100, 40)).toBeLessThanOrEqual(200);
  });

  it('does not produce negative delays', () => {
    expect(listEntranceDelay(-2, 40)).toBe(0);
    expect(listEntranceDelay(2, -40)).toBe(0);
    expect(listEntranceDelay(2, 40, -100)).toBe(0);
  });
});

describe('useInitialListEntrance', () => {
  function track() {
    const seen: boolean[] = [];
    let canEnter!: () => boolean;
    function Harness({ hasData }: { hasData: boolean }) {
      canEnter = useInitialListEntrance(hasData);
      seen.push(canEnter());
      return null;
    }
    return { Harness, seen, canEnter: () => canEnter() };
  }

  it('allows the entrance only during the first render that has data', async () => {
    const { Harness, seen, canEnter } = track();
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(Harness, { hasData: false })); });
    await act(async () => { tree.update(React.createElement(Harness, { hasData: true })); });
    // Rows mounted later (scroll, filter, layout switch) appear in place.
    expect(canEnter()).toBe(false);
    await act(async () => { tree.update(React.createElement(Harness, { hasData: true })); });
    await act(async () => { tree.update(React.createElement(Harness, { hasData: false })); });
    await act(async () => { tree.update(React.createElement(Harness, { hasData: true })); });
    expect(seen).toEqual([false, true, false, false, false]);
    await act(async () => tree.unmount());
  });
});

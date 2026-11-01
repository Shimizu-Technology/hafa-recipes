import React, { act, createRef } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
import { scrollRefToTop, scrollTabToTop, useTabScrollToTop } from './tabScrollToTop';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('scrolls the registered list of a tab and forgets it on unmount', async () => {
  const list = { scrollToOffset: vi.fn() };
  const ref = createRef<unknown>() as React.RefObject<unknown> & { current: unknown };
  ref.current = list;
  function Probe() { useTabScrollToTop('grocery', ref); return null; }
  const r = createRoot();
  await act(async () => r.render(React.createElement(Probe)));
  expect(scrollTabToTop('grocery')).toBe(true);
  expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  expect(scrollTabToTop('planner')).toBe(false);
  await act(async () => r.unmount());
  expect(scrollTabToTop('grocery')).toBe(false);
});

it('handles FlatList, ScrollView and wrapped responders', () => {
  const view = { scrollTo: vi.fn() };
  scrollRefToTop(view);
  expect(view.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  const inner = { scrollTo: vi.fn() };
  scrollRefToTop({ getScrollResponder: () => inner });
  expect(inner.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  expect(() => scrollRefToTop(null)).not.toThrow();
});

import React, { act, createRef } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
import { scrollRefToTop, scrollTabToTop, useTabScrollToTop } from './tabScrollToTop';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('scrolls the registered list of a tab and forgets it on unmount', async () => {
  const list = { scrollToOffset: vi.fn() };
  const ref = createRef<unknown>() as React.RefObject<unknown> & { current: unknown };
  ref.current = list;
  let props!: ReturnType<typeof useTabScrollToTop>;
  function Probe() { props = useTabScrollToTop('grocery', ref); return null; }
  const r = createRoot();
  await act(async () => r.render(React.createElement(Probe)));
  expect(scrollTabToTop('grocery')).toBe(true);
  expect(list.scrollToOffset).not.toHaveBeenCalled();
  expect(props.scrollToOverflowEnabled).toBe(true);
  props.onScrollBeginDrag(drag(-116));
  props.onScrollBeginDrag(drag(640));
  scrollTabToTop('grocery');
  expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: -116, animated: true });
  expect(scrollTabToTop('planner')).toBe(false);
  await act(async () => r.unmount());
  expect(scrollTabToTop('grocery')).toBe(false);
});

const drag = (y: number) => ({ nativeEvent: { contentOffset: { y } } }) as NativeSyntheticEvent<NativeScrollEvent>;

it.each([0, 640])('returns Android or no-large-title content to 0 (first drag at %s)', async y => {
  const scrollTo = vi.fn();
  const ref = { current: { scrollTo } };
  let props!: ReturnType<typeof useTabScrollToTop>;
  function Probe() { props = useTabScrollToTop('planner', ref); return null; }
  const r = createRoot();
  await act(async () => r.render(React.createElement(Probe)));
  props.onScrollBeginDrag(drag(y));
  props.onScrollBeginDrag(drag(800));
  scrollTabToTop('planner');
  expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  await act(async () => r.unmount());
});

it('handles FlatList, ScrollView and wrapped responders', () => {
  const view = { scrollTo: vi.fn() };
  scrollRefToTop(view);
  expect(view.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  const inner = { scrollTo: vi.fn() };
  scrollRefToTop({ getScrollResponder: () => inner }, -116);
  expect(inner.scrollTo).toHaveBeenCalledWith({ y: -116, animated: true });
  expect(() => scrollRefToTop(null)).not.toThrow();
});

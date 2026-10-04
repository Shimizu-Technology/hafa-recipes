import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useRecipeTabScroll } from './useRecipeTabScroll';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('restores an equal-height tab after commit and does not reapply the offset on a later unrelated resize', async () => {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let value!: ReturnType<typeof useRecipeTabScroll<'ingredients' | 'nutrition'>>;
  function Harness() { value = useRecipeTabScroll<'ingredients' | 'nutrition'>('recipe-a', 'ingredients'); return null; }
  const scrollTo = vi.fn(), root = createRoot();
  try {
    await act(async () => root.render(<Harness />));
    value.scrollRef.current = { scrollTo } as any;
    value.onTabsLayout({ nativeEvent: { layout: { y: 100 } } } as any);
    value.onScroll({ nativeEvent: { contentOffset: { y: 300 } } } as any);
    await act(async () => value.selectTab('nutrition'));
    // Equal-height content does not produce a new content-size event.
    await act(async () => frame!(0));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 100, animated: false });
    scrollTo.mockClear(); value.onContentSizeChange();
    expect(scrollTo).not.toHaveBeenCalled();
    value.onScroll({ nativeEvent: { contentOffset: { y: 150 } } } as any);
    await act(async () => value.selectTab('ingredients'));
    await act(async () => frame!(0));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 300, animated: false });
    await act(async () => value.selectTab('nutrition'));
    await act(async () => frame!(0));
    await act(async () => value.selectTab('ingredients', true));
    await act(async () => frame!(0));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 100, animated: false });
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

/** Preserve each tab's reading position, including swaps whose content has equal height. */
export function useRecipeTabScroll<T extends string>(recipeId: string, initialTab: T) {
  const [activeTab, setActiveTab] = useState<T>(initialTab);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const tabsY = useRef(0);
  const offsets = useRef<Partial<Record<T, number>>>({});
  const pending = useRef<number | null>(null);
  useEffect(() => {
    setActiveTab(initialTab);
    offsets.current = {};
    pending.current = null;
    scrollY.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [recipeId, initialTab]);
  useEffect(() => {
    if (pending.current === null) return;
    const frame = requestAnimationFrame(() => {
      if (pending.current === null) return;
      scrollRef.current?.scrollTo({ y: pending.current, animated: false });
      pending.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab]);
  const selectTab = (tab: T, showPreparation = false) => {
    if (tab === activeTab) {
      if (showPreparation) scrollRef.current?.scrollTo({ y: tabsY.current, animated: false });
      return;
    }
    offsets.current[activeTab] = Math.max(0, scrollY.current - tabsY.current);
    pending.current = showPreparation ? tabsY.current : scrollY.current > tabsY.current
      ? tabsY.current + (offsets.current[tab] ?? 0) : scrollY.current;
    setActiveTab(tab);
  };
  return {
    activeTab, selectTab, scrollRef,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { scrollY.current = event.nativeEvent.contentOffset.y; },
    onTabsLayout: (event: LayoutChangeEvent) => { tabsY.current = event.nativeEvent.layout.y; },
    onContentSizeChange: () => {
      // The layout event can arrive before the frame; frame consumption also handles equal heights.
      if (pending.current !== null) scrollRef.current?.scrollTo({ y: pending.current, animated: false });
    },
  };
}

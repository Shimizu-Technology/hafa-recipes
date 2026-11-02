/**
 * Re-tapping the selected tab scrolls that tab's root list to the top. NativeTabs did this
 * for free; Håfa's own tab bar asks the list each tab root registered here.
 */
import { useEffect, useRef, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

type Scrollable = {
  scrollToOffset?: (params: { offset: number; animated?: boolean }) => void;
  scrollTo?: (params: { x?: number; y?: number; animated?: boolean }) => void;
  getScrollResponder?: () => unknown;
};

const scrollers = new Map<string, () => void>();

/** Scroll whatever list `ref` holds (FlatList, SectionList or ScrollView) back to the top. */
export function scrollRefToTop(node: unknown, top = 0) {
  const list = node as Scrollable | null;
  if (!list) return;
  if (list.scrollToOffset) { list.scrollToOffset({ offset: top, animated: true }); return; }
  if (list.scrollTo) { list.scrollTo({ y: top, animated: true }); return; }
  const responder = list.getScrollResponder?.() as Scrollable | undefined;
  responder?.scrollTo?.({ y: top, animated: true });
}

/** Called by the tab bar when the already-selected tab is tapped again. */
export function scrollTabToTop(tab: string): boolean {
  const scroll = scrollers.get(tab);
  scroll?.();
  return Boolean(scroll);
}

/** Register a tab root's main list so a re-tap of its tab scrolls it to the top. */
export function useTabScrollToTop(tab: string, ref: RefObject<unknown>) {
  const rest = useRef<number | null>(null);
  useEffect(() => {
    const scroll = () => {
      // Before the first drag the list is already at rest; 0 would collapse an iOS large title.
      if (rest.current !== null) scrollRefToTop(ref.current, rest.current);
    };
    scrollers.set(tab, scroll);
    return () => { if (scrollers.get(tab) === scroll) scrollers.delete(tab); };
  }, [tab, ref]);
  return {
    // RN otherwise clamps negative automatic insets to -contentInset.top (0).
    scrollToOverflowEnabled: true,
    onScrollBeginDrag(event: NativeSyntheticEvent<NativeScrollEvent>) {
      if (rest.current === null) rest.current = Math.min(0, event.nativeEvent.contentOffset.y);
    },
  } as const;
}

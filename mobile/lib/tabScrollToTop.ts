/**
 * Re-tapping the selected tab scrolls that tab's root list to the top. NativeTabs did this
 * for free; Håfa's own tab bar asks the list each tab root registered here.
 */
import { useEffect, type RefObject } from 'react';

type Scrollable = {
  scrollToOffset?: (params: { offset: number; animated?: boolean }) => void;
  scrollTo?: (params: { x?: number; y?: number; animated?: boolean }) => void;
  getScrollResponder?: () => unknown;
};

const scrollers = new Map<string, () => void>();

/** Scroll whatever list `ref` holds (FlatList, SectionList or ScrollView) back to the top. */
export function scrollRefToTop(node: unknown) {
  const list = node as Scrollable | null;
  if (!list) return;
  if (list.scrollToOffset) { list.scrollToOffset({ offset: 0, animated: true }); return; }
  if (list.scrollTo) { list.scrollTo({ y: 0, animated: true }); return; }
  const responder = list.getScrollResponder?.() as Scrollable | undefined;
  responder?.scrollTo?.({ y: 0, animated: true });
}

/** Called by the tab bar when the already-selected tab is tapped again. */
export function scrollTabToTop(tab: string): boolean {
  const scroll = scrollers.get(tab);
  scroll?.();
  return Boolean(scroll);
}

/** Register a tab root's main list so a re-tap of its tab scrolls it to the top. */
export function useTabScrollToTop(tab: string, ref: RefObject<unknown>) {
  useEffect(() => {
    const scroll = () => scrollRefToTop(ref.current);
    scrollers.set(tab, scroll);
    return () => { if (scrollers.get(tab) === scroll) scrollers.delete(tab); };
  }, [tab, ref]);
}

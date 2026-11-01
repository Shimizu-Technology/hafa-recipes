import { useRef, type RefObject } from "react";
import { useScrollToTop } from "expo-router";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

type Scrollable = {
  scrollTo?(options: { y: number; animated?: boolean }): void;
  scrollToOffset?(options: { offset: number; animated?: boolean }): void;
};

/**
 * Where a tab root rests. Under an iOS large title the resting offset is negative (the
 * automatic content inset), so "top" is the offset seen when the person first starts dragging.
 */
export function useScrollRest() {
  const rest = useRef<number | null>(null);
  return {
    rest,
    onScrollBeginDrag(event: NativeSyntheticEvent<NativeScrollEvent>) {
      if (rest.current === null) rest.current = Math.min(0, event.nativeEvent.contentOffset.y);
    },
  };
}

/**
 * Re-tapping the selected tab scrolls its root back to the top, as the native tab bar did.
 * The JS tab bar emits `tabPress`; this registers the root's list for it. Render only inside a tab.
 */
export function TabScrollToTop({ target, rest }: { target: RefObject<Scrollable | null>; rest: RefObject<number | null> }) {
  const proxy = useRef({
    scrollToTop() {
      const list = target.current;
      const top = rest.current ?? 0;
      if (list?.scrollToOffset) list.scrollToOffset({ offset: top, animated: true });
      else list?.scrollTo?.({ y: top, animated: true });
    },
  });
  useScrollToTop(proxy);
  return null;
}

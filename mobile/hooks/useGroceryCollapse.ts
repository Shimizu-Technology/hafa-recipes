import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HafaWidgetBridge } from 'hafa-widget-bridge';
import {
  EMPTY_COLLAPSED_SECTIONS,
  isSectionCollapsed,
  loadCollapsedSections,
  newerCollapsedSections,
  saveCollapsedSections,
  setSectionsCollapsed,
  toggleSectionCollapsed,
  type CollapsedSections,
} from '@/lib/groceryCollapse';
import type { GrocerySection } from '@/lib/grocerySections';

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

/**
 * Collapsed grocery sections for one list, saved on the device and shared
 * with the home-screen widget. Whichever side changed last wins when the app
 * returns to the foreground or the Grocery tab regains focus.
 */
export function useGroceryCollapse(listId: string | null | undefined) {
  const [collapsed, setCollapsed] = useState<CollapsedSections>(EMPTY_COLLAPSED_SECTIONS);
  const current = useRef(collapsed);
  // Ignores a slow load or widget read that finishes after a newer change.
  const generation = useRef(0);

  const apply = useCallback((next: CollapsedSections, { persist = true, publish = true } = {}) => {
    generation.current += 1;
    current.current = next;
    setCollapsed(next);
    if (!listId) return;
    if (persist) void saveCollapsedSections(listId, next);
    if (publish) void HafaWidgetBridge.setCollapsedSections(listId, next.keys, next.updatedAt).catch(() => false);
  }, [listId]);

  const reconcile = useCallback(async (local: CollapsedSections) => {
    if (!listId) return;
    const started = generation.current;
    const widget = await HafaWidgetBridge.getCollapsedSections().catch(() => null);
    if (generation.current !== started || !widget) return;
    const widgetCopy = widget.listId === listId ? { keys: widget.keys, updatedAt: widget.updatedAt ?? 0 } : null;
    if (newerCollapsedSections(local, widgetCopy) === 'widget' && widgetCopy) {
      apply(widgetCopy, { publish: false });
    } else if (widget.listId === listId && !sameKeys(widget.keys, local.keys)) {
      // The widget is behind, or recorded nothing yet (a new install or an
      // older widget build). Give it the app's choice.
      void HafaWidgetBridge.setCollapsedSections(listId, local.keys, local.updatedAt).catch(() => false);
    }
  }, [apply, listId]);

  useEffect(() => {
    if (!listId) return;
    const started = ++generation.current;
    void loadCollapsedSections(listId).then((stored) => {
      if (generation.current !== started) return;
      current.current = stored;
      setCollapsed(stored);
      void reconcile(stored);
    });
  }, [listId, reconcile]);

  useFocusEffect(useCallback(() => { void reconcile(current.current); }, [reconcile]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcile(current.current);
    });
    return () => subscription.remove();
  }, [reconcile]);

  const isCollapsed = useCallback(
    (section: Pick<GrocerySection, 'key' | 'title'>) => isSectionCollapsed(collapsed.keys, section),
    [collapsed],
  );
  const toggle = useCallback(
    (section: Pick<GrocerySection, 'key' | 'title'>) => apply(toggleSectionCollapsed(current.current, section)),
    [apply],
  );
  const setAll = useCallback(
    (sections: readonly Pick<GrocerySection, 'key' | 'title'>[], value: boolean) =>
      apply(setSectionsCollapsed(current.current, sections, value)),
    [apply],
  );

  return { isCollapsed, toggle, setAll };
}

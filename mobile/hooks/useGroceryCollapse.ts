import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HafaWidgetBridge } from 'hafa-widget-bridge';
import {
  EMPTY_COLLAPSED_SECTIONS,
  canonicalCollapsedKeys,
  collapseScopeKey,
  expandAllSections,
  isSectionCollapsed,
  isValidCollapseScope,
  loadCollapsedSections,
  newerCollapsedSections,
  saveCollapsedSections,
  setSectionsCollapsed,
  toggleSectionCollapsed,
  type CollapseScope,
  type CollapsedSections,
} from '@/lib/groceryCollapse';
import type { GrocerySection } from '@/lib/grocerySections';

type Section = Pick<GrocerySection, 'key' | 'title'>;

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

/**
 * Collapsed grocery sections for one account's view of one list, saved on the
 * device and shared with the home-screen widget. Whichever side changed last
 * wins when the app returns to the foreground or the Grocery tab regains
 * focus.
 *
 * Nothing is compared with the widget or changed by a tap until this scope's
 * saved choice has loaded, so an empty starting state never overwrites it.
 * `sections` is the whole list (not a search or To buy view), or null while
 * it is loading; folds for groups no longer on it are dropped.
 */
export function useGroceryCollapse(scope: CollapseScope | null | undefined, sections: readonly Section[] | null) {
  const accountScopeId = scope?.accountScopeId ?? '';
  const listId = scope?.listId ?? '';
  const scopeKey = isValidCollapseScope({ accountScopeId, listId }) ? collapseScopeKey({ accountScopeId, listId }) : null;

  const [loaded, setLoaded] = useState<{ scopeKey: string; value: CollapsedSections } | null>(null);
  // The loaded choice for the current scope only; null until it has loaded.
  const current = useRef<{ scopeKey: string; value: CollapsedSections } | null>(null);
  // Ignores a slow load or widget read that finishes after a newer change or
  // a switch to another account or list.
  const generation = useRef(0);
  const latestSections = useRef(sections);
  latestSections.current = sections;

  const canonical = useCallback((value: CollapsedSections): CollapsedSections => {
    const whole = latestSections.current;
    return whole ? { ...value, keys: canonicalCollapsedKeys(value.keys, whole) } : value;
  }, []);

  const publish = useCallback((value: CollapsedSections) => {
    void HafaWidgetBridge.setCollapsedSections(accountScopeId, listId, value.keys, value.updatedAt).catch(() => false);
  }, [accountScopeId, listId]);

  const commit = useCallback((next: CollapsedSections, { persist = true, share = true, invalidate = true } = {}) => {
    if (!scopeKey || current.current?.scopeKey !== scopeKey) return;
    // Tidying keys is not a new choice, so it leaves a pending widget read alone.
    if (invalidate) generation.current += 1;
    const entry = { scopeKey, value: next };
    current.current = entry;
    setLoaded(entry);
    if (persist) void saveCollapsedSections({ accountScopeId, listId }, next);
    if (share) publish(next);
  }, [accountScopeId, listId, publish, scopeKey]);

  const reconcile = useCallback(async () => {
    if (!scopeKey || current.current?.scopeKey !== scopeKey) return;
    const started = generation.current;
    const widget = await HafaWidgetBridge.getCollapsedSections().catch(() => null);
    const entry = current.current;
    if (generation.current !== started || entry?.scopeKey !== scopeKey || !widget) return;
    // The widget may show another account or list; its folds are not ours.
    if (widget.accountScopeId !== accountScopeId || widget.listId !== listId) return;
    const widgetCopy = canonical({ keys: widget.keys, updatedAt: widget.updatedAt ?? 0 });
    if (newerCollapsedSections(entry.value, widgetCopy) === 'widget') {
      commit(widgetCopy, { share: !sameKeys(widgetCopy.keys, widget.keys) });
    } else if (!sameKeys(widget.keys, entry.value.keys)) {
      // The widget is behind, or recorded nothing yet (a new install or an
      // older widget build). Give it the app's choice.
      publish(entry.value);
    }
  }, [accountScopeId, canonical, commit, listId, publish, scopeKey]);

  useEffect(() => {
    // A new scope starts unloaded; the previous list's folds never show here.
    generation.current += 1;
    current.current = null;
    if (!scopeKey) return;
    const started = generation.current;
    void loadCollapsedSections({ accountScopeId, listId }).then((stored) => {
      if (generation.current !== started) return;
      const value = canonical(stored);
      const entry = { scopeKey, value };
      current.current = entry;
      setLoaded(entry);
      if (!sameKeys(value.keys, stored.keys)) {
        void saveCollapsedSections({ accountScopeId, listId }, value);
        publish(value);
      }
      void reconcile();
    });
  }, [accountScopeId, canonical, listId, publish, reconcile, scopeKey]);

  // Groups can leave the list, and an old title fold may load before the list
  // does. Tidy the saved keys once the whole list is known.
  useEffect(() => {
    const entry = current.current;
    if (!sections || !entry || entry.scopeKey !== scopeKey) return;
    const keys = canonicalCollapsedKeys(entry.value.keys, sections);
    if (!sameKeys(keys, entry.value.keys)) commit({ ...entry.value, keys }, { invalidate: false });
  }, [commit, loaded, scopeKey, sections]);

  useFocusEffect(useCallback(() => { void reconcile(); }, [reconcile]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcile();
    });
    return () => subscription.remove();
  }, [reconcile]);

  const collapsed = scopeKey && loaded?.scopeKey === scopeKey ? loaded.value : EMPTY_COLLAPSED_SECTIONS;
  const isCollapsed = useCallback(
    (section: Pick<GrocerySection, 'key'>) => isSectionCollapsed(collapsed.keys, section),
    [collapsed],
  );
  const update = useCallback((change: (value: CollapsedSections) => CollapsedSections) => {
    const entry = current.current;
    if (entry && entry.scopeKey === scopeKey) commit(change(entry.value));
  }, [commit, scopeKey]);
  const toggle = useCallback(
    (section: Pick<GrocerySection, 'key'>) => update((value) => toggleSectionCollapsed(value, section)),
    [update],
  );
  const setAll = useCallback(
    (targets: readonly Pick<GrocerySection, 'key'>[], value: boolean) =>
      update((currentValue) => setSectionsCollapsed(currentValue, targets, value)),
    [update],
  );
  const expandAll = useCallback(() => update(() => expandAllSections()), [update]);

  return { isCollapsed, toggle, setAll, expandAll };
}

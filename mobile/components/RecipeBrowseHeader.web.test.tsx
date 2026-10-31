import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('expo-router', () => ({ Stack: { Screen: 'Screen' }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('@/components/TabChrome', () => ({ AccountHeaderButton: 'AccountHeaderButton' }));
vi.mock('@/components/Themed', () => ({ IconButton: 'IconButton', useColors: () => ({}) }));
import { RecipeBrowseHeader } from './RecipeBrowseHeader.web';
it('keeps web browse actions reachable through a browser-native popover alongside Add and account', async () => {
  const r = createRoot(), header = createRoot();
  const action = vi.fn();
  try {
    await act(async () => r.render(<RecipeBrowseHeader library actions={[{ title: 'Filter recipes', onPress: action }]} />));
    await act(async () => header.render(r.container.queryAll(n => n.type === 'Screen')[0].props.options.headerRight()));
    const trigger = header.container.queryAll(n => n.type === 'button' && n.props['aria-label'] === 'Library options')[0];
    const panel = header.container.queryAll(n => n.type === 'div' && n.props.popover === 'auto')[0];
    expect(trigger.props.popoverTarget).toBe(panel.props.id);
    await act(async () => header.container.queryAll(n => n.type === 'button' && n.props.children === 'Filter recipes')[0].props.onClick());
    expect(action).toHaveBeenCalledOnce();
    expect(header.container.queryAll(n => n.props.accessibilityLabel === 'Add a recipe')).toHaveLength(1);
    expect(header.container.queryAll(n => n.type === 'AccountHeaderButton')).toHaveLength(1);
  } finally { await act(async () => header.unmount()); await act(async () => r.unmount()); }
});

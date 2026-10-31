import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ platform: 'ios', push: vi.fn(), image: vi.fn(async (name: string) => ({ uri: 'fixture://' + name })) }));
vi.mock('expo-router', () => ({ Stack: { Screen: 'Screen', Toolbar: Object.assign((props: any) => React.createElement('Toolbar', props, props.children), { Menu: 'Menu', Label: 'Label', MenuAction: 'MenuAction', Button: 'ToolbarButton', View: 'ToolbarView' }) }, useRouter: () => ({ push: state.push }) }));
vi.mock('react-native', () => ({ View: 'View', Platform: { get OS() { return state.platform; } } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: { getImageSource: state.image } }));
vi.mock('@/components/TabChrome', () => ({ AccountHeaderButton: 'AccountHeaderButton' }));
vi.mock('@/components/Themed', () => ({ IconButton: 'IconButton', useColors: () => ({ actionText: '#1E7F6E' }) }));
import { RecipeBrowseHeader } from './RecipeBrowseHeader.web';
import { RecipeBrowseHeader as NativeHeader } from './RecipeBrowseHeader';
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

it.each(['ios', 'android'])('exposes native menu actions, Add and account on %s', async platform => {
  state.platform = platform;
  const r = createRoot();
  const action = vi.fn();
  try {
    await act(async () => r.render(<NativeHeader library actions={[{ title: 'Filter recipes', onPress: action }]} />));
    const menu = r.container.queryAll(n => n.type === 'Menu')[0];
    const add = r.container.queryAll(n => n.type === 'ToolbarButton')[0];
    expect(menu.props.icon).toEqual(platform === 'ios' ? 'ellipsis' : { uri: 'fixture://ellipsis-horizontal' });
    expect(add.props.icon).toEqual(platform === 'ios' ? 'plus' : { uri: 'fixture://add' });
    const option = r.container.queryAll(n => n.type === 'MenuAction')[0];
    expect(option.props.children).toBe('Filter recipes');
    await act(async () => option.props.onPress());
    expect(action).toHaveBeenCalledOnce();
    await act(async () => add.props.onPress());
    expect(state.push).toHaveBeenCalledWith('/add-options');
    expect(r.container.queryAll(n => n.type === 'AccountHeaderButton')).toHaveLength(1);
  } finally { await act(async () => r.unmount()); state.platform = 'ios'; }
});

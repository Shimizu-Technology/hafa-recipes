import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ alert: vi.fn(), push: vi.fn(), toast: vi.fn(), revoke: vi.fn(), links: {} as any, signedIn: true }));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Alert: { alert: m.alert }, Pressable: 'Pressable', RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
vi.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: m.push }) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: m.signedIn }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', Button: 'Button', useColors: () => ({}) }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'Thumbnail' }));
vi.mock('@/components/SignInRequiredView', () => ({ SignInRequiredView: 'SignInRequired' }));
vi.mock('@/lib/toast', () => ({ showToast: m.toast }));
vi.mock('@/hooks/useRecipeShareLink', () => ({
  useActiveRecipeLinks: () => m.links,
  useRevokeRecipeLink: () => ({ mutateAsync: m.revoke, isPending: false, variables: undefined }),
}));

import SharingLinksScreen from '../app/sharing-links';

const texts = (root: any) => root.container.queryAll((n: any) => n.type === 'Text')
  .map((n: any) => n.children.filter((c: unknown) => typeof c === 'string').join('')).join('\n');
const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<SharingLinksScreen />));
  return root;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.signedIn = true;
  m.links = { isLoading: false, isRefetching: false, error: null, data: [], refetch: vi.fn() };
});

describe('Settings › Sharing links', () => {
  it('lists each recipe with when its link was made and opens the recipe', async () => {
    m.links.data = [{ recipe: { id: 'r1', title: 'Sunday Bread', thumbnail_url: null }, createdAt: '2026-11-16T03:00:00Z' }];
    const root = await render();
    expect(texts(root)).toContain('Sunday Bread');
    expect(texts(root)).toMatch(/Link active · created Nov 1[56]/);
    const open = root.container.queryAll((n: any) => n.type === 'Pressable' && String(n.props.accessibilityLabel).startsWith('Sunday Bread'))[0];
    await act(async () => open.props.onPress());
    expect(m.push).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'r1' } });
  });

  it('turns a link off only after confirming', async () => {
    m.links.data = [{ recipe: { id: 'r1', title: 'Sunday Bread', thumbnail_url: null }, createdAt: null }];
    m.revoke.mockResolvedValue(undefined);
    const root = await render();
    const turnOff = root.container.queryAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Turn off link to Sunday Bread')[0];
    await act(async () => turnOff.props.onPress());
    expect(m.revoke).not.toHaveBeenCalled();
    const [title, , buttons] = m.alert.mock.calls[0];
    expect(title).toBe('Turn off this link?');
    await act(async () => { buttons.find((b: any) => b.text === 'Turn off').onPress(); });
    expect(m.revoke).toHaveBeenCalledWith('r1');
    expect(m.toast).toHaveBeenCalledWith({ message: 'Link turned off', tone: 'success' });
  });

  it('shows an empty state with no links', async () => {
    expect(texts(await render())).toContain('No active links');
  });

  it('says links aren’t available yet before the links table exists, without a retry loop', async () => {
    m.links.error = { response: { status: 503 } };
    const root = await render();
    expect(texts(root)).toContain('Private links aren’t available yet.');
    expect(root.container.queryAll((n: any) => n.type === 'Button')).toHaveLength(0);
  });

  it('offers a retry for other failures', async () => {
    m.links.error = { message: 'Network Error' };
    const root = await render();
    expect(texts(root)).toContain('Couldn’t load your links.');
    await act(async () => root.container.queryAll((n: any) => n.type === 'Button')[0].props.onPress());
    expect(m.links.refetch).toHaveBeenCalled();
  });
});

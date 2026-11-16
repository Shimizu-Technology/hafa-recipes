import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  share: vi.fn(), copy: vi.fn(), toast: vi.fn(), close: vi.fn(), create: vi.fn(), revoke: vi.fn(),
  link: {} as Record<string, unknown>, fontScale: 1, blur: null as null | (() => void),
}));
vi.mock('react-native', () => ({
  Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', View: 'View', ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' }, Share: { share: m.share, sharedAction: 'sharedAction' },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, useWindowDimensions: () => ({ fontScale: m.fontScale }),
}));
vi.mock('expo-router', () => ({ useNavigation: () => ({ addListener: (event: string, handler: () => void) => {
  if (event === 'blur') m.blur = handler;
  return () => { m.blur = null; };
} }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: m.copy }));
vi.mock('@/components/Themed', async () => ({ Text: 'Text', Button: 'Button', TextScaleContext: (await import('react')).createContext(1),
  useColors: () => ({ ink: 'INK', onInk: 'ON_INK', textSecondary: 'MUTED' }) }));
vi.mock('@/components/RecipeDetailRow', () => ({ RecipeDetailRow: 'Row' }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'Thumbnail' }));
vi.mock('@/lib/toast', () => ({ showToast: m.toast }));
vi.mock('@/components/Toast', () => ({ ToastHost: 'ToastHost' }));
vi.mock('@/utils/haptics', () => ({ haptics: { success: vi.fn() } }));
vi.mock('@/hooks/useRecipeShareLink', () => ({ useRecipeShareLink: () => m.link }));

import { ShareRecipeSheet } from './ShareRecipeSheet';

const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const TOKEN_URL = 'https://hafa-recipes.com/r/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const recipe = (is_public: boolean, moderation_status: 'active' | 'hidden' = 'active') => ({
  id: ID, is_public, moderation_status, thumbnail_url: null, source_type: 'tiktok', extractor_display_name: 'Leon',
  source_url: 'https://www.tiktok.com/@thecoreyb/video/7312345678901234567',
  extracted: { title: 'Sunday Bread', servings: 8, times: { total: '70 min' }, notes: null, components: [
    { name: '', ingredients: [{ name: 'flour', quantity: '3', unit: 'cups' }], steps: ['Mix.'] },
  ] },
}) as any;

function link(state: Partial<{ active: boolean; url: string | null; createdAt: string | null; isLoading: boolean; isUnavailable: boolean; isError: boolean }> = {}) {
  m.link = {
    isLoading: false, isUnavailable: false, isError: false, active: false, url: null, createdAt: null, isRevoking: false,
    refetch: vi.fn(), create: { mutateAsync: m.create }, revoke: m.revoke, ...state,
  };
}

async function open(r: any, isOwner = true, scaledServings?: number) {
  const root = createRoot();
  await act(async () => root.render(<ShareRecipeSheet recipe={r} isOwner={isOwner} visible onClose={m.close} scaledServings={scaledServings} />));
  return root;
}
const texts = (root: any) => root.container.queryAll((n: any) => n.type === 'Text').map((n: any) => n.children.filter((c: unknown) => typeof c === 'string').join('')).join('\n');
const button = (root: any, title: string) => root.container.queryAll((n: any) => n.type === 'Button' && n.props.title === title)[0];
const row = (root: any, title: string) => root.container.queryAll((n: any) => n.type === 'Row' && n.props.title === title)[0];
const pressText = async (root: any, label: string) => {
  // The innermost pressable holding the label (the overlay and sheet hold everything).
  const node = root.container.queryAll((n: any) => n.type === 'Pressable' && n.queryAll((t: any) => t.type === 'Text' && t.children.includes(label)).length).at(-1);
  await act(async () => node.props.onPress());
};

beforeEach(() => {
  vi.clearAllMocks();
  m.share.mockResolvedValue({ action: 'sharedAction' });
  m.fontScale = 1;
  link();
});

describe('share recipe sheet', () => {
  it('shows its toasts above the sheet, without a second announcement', async () => {
    link();
    const root = await open(recipe(true));
    const modal = root.container.queryAll((n: any) => n.type === 'Modal')[0];
    const hosts = modal.queryAll((n: any) => n.type === 'ToastHost');
    expect(hosts).toHaveLength(1);
    expect(hosts[0].props.announce).toBe(false);
  });

  it('sends a public recipe’s own link as a lone URL and closes once sent', async () => {
    const root = await open(recipe(true));
    expect(texts(root)).toContain('Public in Discover. Anyone with the link can open it.');
    expect(texts(root)).toContain('on Håfa Recipes');
    await act(async () => button(root, 'Send link').props.onPress());
    expect(m.share).toHaveBeenCalledWith({ url: `https://hafa-recipes.com/r/${ID}` });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.close).toHaveBeenCalled();
  });

  it('confirms once, then creates and sends the first private link', async () => {
    m.create.mockResolvedValue({ stored: { url: TOKEN_URL, createdAt: '2026-11-16T03:00:00Z' } });
    const root = await open(recipe(false));
    expect(texts(root)).toContain('Only you can open it');
    await act(async () => button(root, 'Send link').props.onPress());
    expect(m.share).not.toHaveBeenCalled();
    expect(texts(root)).toContain('Send a private link?');
    expect(texts(root)).toContain('Anyone with this link can open it. It won’t appear in Discover.');
    await act(async () => button(root, 'Create link').props.onPress());
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.share).toHaveBeenCalledWith({ url: TOKEN_URL });
  });

  it('copies the link kept on this phone without asking again', async () => {
    link({ active: true, url: TOKEN_URL, createdAt: '2026-11-16T03:00:00Z' });
    const root = await open(recipe(false));
    await act(async () => row(root, 'Copy link').props.onPress());
    expect(m.copy).toHaveBeenCalledWith(TOKEN_URL);
    expect(m.toast).toHaveBeenCalledWith({ message: 'Link copied', tone: 'success' });
    expect(m.create).not.toHaveBeenCalled();
    expect(texts(root)).toContain('Link active · created Nov 16');
  });

  it('turns off an active link after confirming', async () => {
    link({ active: true, url: TOKEN_URL, createdAt: '2026-11-16T03:00:00Z' });
    m.revoke.mockResolvedValue(undefined);
    const root = await open(recipe(false));
    await pressText(root, 'Turn off link');
    expect(texts(root)).toContain('Turn off this link?');
    expect(m.revoke).not.toHaveBeenCalled();
    await act(async () => button(root, 'Turn off link').props.onPress());
    expect(m.revoke).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith({ message: 'Link turned off', tone: 'success' });
  });

  it('keeps replacing a link behind its own confirmation', async () => {
    link({ active: true, url: TOKEN_URL, createdAt: '2026-11-16T03:00:00Z' });
    m.create.mockResolvedValue({ stored: { url: TOKEN_URL.replace('abcde', 'vwxyz'), createdAt: null } });
    const root = await open(recipe(false));
    await pressText(root, 'Replace with a new link');
    expect(texts(root)).toContain('The current link stops opening right away.');
    await act(async () => button(root, 'Replace link').props.onPress());
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.share).not.toHaveBeenCalled();
    expect(m.toast).toHaveBeenCalledWith({ message: 'New link ready', tone: 'success' });
  });

  it('keeps Send and Copy off when the link status check failed, offering Try again instead', async () => {
    link({ isError: true });
    const root = await open(recipe(false));
    expect(button(root, 'Send link').props.disabled).toBe(true);
    expect(row(root, 'Copy link').props.disabled).toBe(true);
    await act(async () => button(root, 'Send link').props.onPress());
    await act(async () => row(root, 'Copy link').props.onPress());
    expect(texts(root)).not.toContain('Send a private link?');
    expect(m.create).not.toHaveBeenCalled();
    expect(m.share).not.toHaveBeenCalled();
    await pressText(root, 'Try again');
    expect((m.link as any).refetch).toHaveBeenCalled();
  });

  it('explains a replacement when the active link isn’t on this phone', async () => {
    link({ active: true, url: null, createdAt: '2026-11-16T03:00:00Z' });
    const root = await open(recipe(false));
    await act(async () => button(root, 'Send link').props.onPress());
    expect(texts(root)).toContain('Make a new link?');
    expect(m.share).not.toHaveBeenCalled();
  });

  it('offers only text while a recipe is under review, without any Håfa link', async () => {
    const root = await open(recipe(true, 'hidden'));
    expect(button(root, 'Send link')).toBeUndefined();
    expect(row(root, 'Copy link')).toBeUndefined();
    expect(texts(root)).toContain('Under review');
    await act(async () => button(root, 'Send as text').props.onPress());
    const { message } = m.share.mock.calls[0][0];
    expect(message).toContain('• 3 cups flour');
    expect(message).not.toContain('hafa-recipes.com');
    expect(message.endsWith('Shared from Håfa Recipes')).toBe(true);
  });

  it('ends a public recipe’s text with its link and credits the original', async () => {
    const root = await open(recipe(true), false);
    expect(texts(root)).toContain('Recipe by Leon · TikTok video by @thecoreyb');
    await act(async () => row(root, 'Send as text').props.onPress());
    const { message } = m.share.mock.calls[0][0];
    expect(message).toContain('Recipe by Leon on Håfa');
    expect(message.endsWith(`Open it in Håfa Recipes: https://hafa-recipes.com/r/${ID}`)).toBe(true);
    await act(async () => row(root, 'Original').props.onPress());
    expect(m.share.mock.calls[1][0].message).toBe('Sunday Bread, original by @thecoreyb:\nhttps://www.tiktok.com/@thecoreyb/video/7312345678901234567');
  });

  it('falls back to text when private links aren’t available on this API', async () => {
    link({ isUnavailable: true });
    const root = await open(recipe(false));
    expect(texts(root)).toContain('Private links aren’t available yet.');
    expect(button(root, 'Send as text')).toBeDefined();
    expect(row(root, 'Copy link')).toBeUndefined();
  });

  it('starts Send as text on the scaled servings the reader is looking at, with the choice clearly marked', async () => {
    const root = await open(recipe(true), true, 12);
    const options = root.container.queryAll((n: any) => n.type === 'Pressable' && n.props.accessibilityRole === 'radio');
    expect(options.map((n: any) => n.props.accessibilityState.selected)).toEqual([false, true]);
    // The selected option is filled with ink so it reads in dark mode too.
    expect(options[1].props.style).toContainEqual({ backgroundColor: 'INK' });
    await act(async () => row(root, 'Send as text').props.onPress());
    expect(m.share.mock.calls[0][0].message).toContain('Serves 12 (scaled from 8)');
    await act(async () => options[0].props.onPress());
    await act(async () => row(root, 'Send as text').props.onPress());
    expect(m.share.mock.calls[1][0].message).toContain('Serves 8 · 70 min');
  });

  it('puts long credits on their own line under the row title', async () => {
    const root = await open(recipe(true));
    // Every action row uses the one stacked layout, so they line up.
    for (const title of ['Copy link', 'Send as text', 'Original']) {
      expect(row(root, title).props.stacked).toBe(true);
      expect(row(root, title).props.accessory).toBeUndefined();
    }
  });

  it('keeps Send link on the first screen at accessibility text sizes', async () => {
    m.fontScale = 3.1;
    const root = await open(recipe(true));
    expect(root.container.queryAll((n: any) => n.type === 'Thumbnail')).toHaveLength(0);
    const title = root.container.queryAll((n: any) => n.type === 'Text' && n.children.includes('Sunday Bread'))[0];
    expect(title.props.numberOfLines).toBeUndefined();
    expect(texts(root)).not.toContain('Serves 8 · 70 min');
    // Send link comes straight after the card, ahead of the footnote.
    const order = root.container.queryAll((n: any) => (n.type === 'Button' && n.props.title === 'Send link')
      || (n.type === 'Text' && n.children.includes('Public in Discover. Anyone with the link can open it.')));
    expect(order[0].type).toBe('Button');
  });

  it('closes when another screen opens over the recipe', async () => {
    await open(recipe(true));
    await act(async () => m.blur!());
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it.each(['backdrop', 'header back', 'blur'])('never sends or copies a link that finishes creating after the sheet was left (%s)', async way => {
    let finish!: (value: unknown) => void;
    m.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const root = await open(recipe(false));
    await act(async () => button(root, 'Send link').props.onPress());
    let pending!: Promise<void>;
    await act(async () => { pending = button(root, 'Create link').props.onPress(); });
    await act(async () => {
      if (way === 'blur') m.blur!();
      else if (way === 'header back') root.container.queryAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Back')[0].props.onPress();
      else root.container.queryAll((n: any) => n.type === 'Pressable')[0].props.onPress();
    });
    await act(async () => { finish({ stored: { url: TOKEN_URL, createdAt: '2026-11-16T03:00:00Z' } }); await pending; });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.share).not.toHaveBeenCalled();
    expect(m.copy).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
  });

  it('says the link changed on another device instead of sending a dead link', async () => {
    m.create.mockRejectedValue(Object.assign(new Error('replaced'), { code: 'LINK_REPLACED_ELSEWHERE' }));
    const root = await open(recipe(false));
    await act(async () => button(root, 'Send link').props.onPress());
    await act(async () => button(root, 'Create link').props.onPress());
    expect(m.share).not.toHaveBeenCalled();
    expect(m.toast).toHaveBeenCalledWith({ message: 'This link was just changed on another device. Try again.', tone: 'error' });
  });
});

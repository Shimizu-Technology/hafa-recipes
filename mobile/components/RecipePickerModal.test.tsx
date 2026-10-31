import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecipeListItem } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Chip: 'Chip',
  Text: 'Text',
  View: 'View',
  useColors: () => ({
    background: '#fff', border: '#ddd', card: '#fff', cardBorder: '#ddd',
    text: '#111', textMuted: '#666', warning: '#8a5a00',
    tint: mocks.theme === 'dark' ? '#5DD3B6' : '#1E7F6E',
    onTint: mocks.theme === 'dark' ? '#00261F' : '#FFFFFF',
  }),
}));
const mocks = vi.hoisted(() => ({
  search: vi.fn(), fetchNextPage: vi.fn(), refetch: vi.fn(),
  error: false, loading: false, more: true, theme: 'light' as 'light' | 'dark',
}));
vi.mock('@/hooks/useRecipes', () => ({
  usePlannerRecipeSearch: (...args: unknown[]) => {
    mocks.search(...args);
    return { data: { pages: [{ items: [] }] }, isError: mocks.error, isLoading: mocks.loading,
      hasNextPage: mocks.more, isFetchingNextPage: false, fetchNextPage: mocks.fetchNextPage,
      isFetching: false, refetch: mocks.refetch };
  },
  usePopularTags: () => ({ data: [{ tag: 'baking', count: 2 }] }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { full: 999, md: 12, lg: 16 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/utils/haptics', () => ({ lightHaptic: vi.fn() }));
vi.mock('@/components/RecipeTrustBadge', async () => {
  const ReactModule = await import('react');
  return {
    RecipeTrustBadge: ({ reviewState }: { reviewState?: string }) => {
      const label = reviewState === 'needs_review'
        ? 'Recipe needs review'
        : reviewState === 'source_incomplete'
          ? 'Recipe needs source details'
          : null;
      return label
        ? ReactModule.createElement('RecipeTrustBadge', { accessibilityLabel: label })
        : null;
    },
  };
});

import RecipePickerModal, { RecipePickerRow } from './RecipePickerModal';

const colors = {
  background: '#fff', border: '#ddd', card: '#fff', cardBorder: '#ddd',
  text: '#111', textMuted: '#666', tint: '#155c52', warning: '#8a5a00',
} as any;

function recipe(
  reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined,
): RecipeListItem {
  return {
    id: 'recipe-1',
    title: 'Chicken Kelaguen',
    source_url: 'https://example.com/recipe',
    source_type: 'website',
    thumbnail_url: null,
    extraction_quality: null,
    has_audio_transcript: false,
    tags: [],
    servings: null,
    total_time: null,
    created_at: '2026-09-06T00:00:00Z',
    user_id: 'stable-app-user',
    extractor_display_name: 'Cook',
    is_public: false,
    review_state: reviewState,
  };
}

async function renderRow(reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => {
    renderer.render(React.createElement(RecipePickerRow, {
      item: recipe(reviewState),
      colors,
      onPress: vi.fn(),
    }));
  });
  return renderer;
}

describe('recipe picker readiness', () => {
  it.each([
    ['needs_review', 'Recipe needs review'],
    ['source_incomplete', 'Recipe needs source details'],
  ] as const)('renders %s on recipe choices', async (state, label) => {
    const renderer = await renderRow(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === label,
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it.each(['ready', undefined] as const)('hides a badge for %s recipes', async (state) => {
    const renderer = await renderRow(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel?.startsWith('Recipe needs'),
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

describe('planner scoped recipe search', () => {
  beforeEach(() => { vi.useRealTimers(); mocks.search.mockClear(); mocks.fetchNextPage.mockClear(); mocks.refetch.mockClear(); mocks.error = false; });
  it('searches beyond loaded pages, paginates Saved and remembers scope/query between slots', async () => {
    vi.useFakeTimers();
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<RecipePickerModal visible onClose={vi.fn()} onSelect={vi.fn()} />));
      expect(mocks.search).toHaveBeenLastCalledWith('all', expect.objectContaining({ query: '' }), true);
      const saved = renderer.container.queryAll(node => node.type === 'Chip' && node.props.label === 'Saved')[0];
      await act(async () => saved.props.onPress());
      await act(async () => renderer.container.queryAll(node => node.type === 'TextInput')[0].props.onChangeText('Kelaguen'));
      await act(async () => vi.advanceTimersByTime(250));
      expect(mocks.search).toHaveBeenLastCalledWith('saved', expect.objectContaining({ query: 'Kelaguen' }), true);
      await act(async () => renderer.container.queryAll(node => node.type === 'FlatList')[0].props.onEndReached());
      expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
      await act(async () => renderer.render(<RecipePickerModal visible={false} onClose={vi.fn()} onSelect={vi.fn()} />));
      expect(mocks.search).toHaveBeenLastCalledWith('saved', expect.objectContaining({ query: 'Kelaguen' }), false);
      await act(async () => renderer.render(<RecipePickerModal visible title="Add dinner" onClose={vi.fn()} onSelect={vi.fn()} />));
      expect(mocks.search).toHaveBeenLastCalledWith('saved', expect.objectContaining({ query: 'Kelaguen' }), true);
    } finally { await act(async () => renderer.unmount()); vi.useRealTimers(); }
  });
  it('shows scope-specific errors and Retry, without triggering pagination after failure', async () => {
    mocks.error = true;
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<RecipePickerModal visible onClose={vi.fn()} onSelect={vi.fn()} />));
      const retry = renderer.container.queryAll(node => node.props.accessibilityLabel === 'Retry recipe search')[0];
      await act(async () => retry.props.onPress());
      expect(mocks.refetch).toHaveBeenCalledOnce();
      await act(async () => renderer.container.queryAll(node => node.type === 'FlatList')[0].props.onEndReached());
      expect(mocks.fetchNextPage).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); }
  });
});

it.each(['light', 'dark'] as const)('pairs selected picker foregrounds and fills in %s mode', async theme => {
  mocks.theme = theme;
  const tint = theme === 'dark' ? '#5DD3B6' : '#1E7F6E';
  const onTint = theme === 'dark' ? '#00261F' : '#FFFFFF';
  const renderer = createRoot();
  const flatten = (style: any) => Object.assign({}, ...(Array.isArray(style) ? style : [style]));
  const control = (label: string) => renderer.container.queryAll(node => node.type === 'TouchableOpacity' &&
    (node.props.children as React.ReactElement<any>)?.props?.children === label)[0];
  const filter = () => renderer.container.queryAll(node => node.type === 'TouchableOpacity' &&
    (node.props.children as React.ReactElement<any>)?.props?.name === 'options-outline')[0];
  try {
    await act(async () => renderer.render(<RecipePickerModal visible onClose={vi.fn()} onSelect={vi.fn()} />));
    await act(async () => filter().props.onPress());
    for (const label of ['< 30 min', 'baking']) {
      await act(async () => control(label).props.onPress());
      expect(flatten(control(label).props.style).backgroundColor).toBe(tint);
      expect(flatten((control(label).props.children as React.ReactElement<any>).props.style).color).toBe(onTint);
    }
    expect(flatten(filter().props.style).backgroundColor).toBe(tint);
    expect((filter().props.children as React.ReactElement<any>).props.color).toBe(onTint);
  } finally { await act(async () => renderer.unmount()); mocks.theme = 'light'; }
});

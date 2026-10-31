const routeMocks = vi.hoisted(() => ({ params: {} as Record<string, string>, scrollTo: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { previewMealPlanGroceries: vi.fn() } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'request-id' }));
const reviewMocks = vi.hoisted(() => ({ session: 'session-a', state: {} as any, update: vi.fn(async () => ({})), add: vi.fn(async (_input: any) => ({ items_added: 2, items_missing_amount: 1 })) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => reviewMocks.state }));
import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MealPlanEntry } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
  useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1, scale: 3 }),
  ActivityIndicator: 'ActivityIndicator',
  Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  TextInput: 'TextInput',
  Alert: { alert: vi.fn() },
  Dimensions: { get: () => ({ width: 390 }) },
  Image: 'Image',
  RefreshControl: 'RefreshControl',
  ScrollView: React.forwardRef((props: any, ref) => { React.useImperativeHandle(ref, () => ({ scrollTo: routeMocks.scrollTo })); return React.createElement('ScrollView', props, props.children); }),
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 104 }));
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => routeMocks.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: reviewMocks.session, sessionId: reviewMocks.session }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  IconButton: 'IconButton',
  Button: 'Button',
  Text: 'Text',
  View: 'View',
  useColors: () => ({
    card: '#fff', cardBorder: '#ddd', text: '#111', textMuted: '#666',
    tint: '#155c52', warning: '#8a5a00',
  }),
}));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: 'SignInBanner' }));
vi.mock('@/components/Animated', () => ({
  AnimatedListItem: 'AnimatedListItem',
  ScalePressable: 'ScalePressable',
}));
vi.mock('@/components/RecipePickerModal', () => ({ default: 'RecipePickerModal' }));
vi.mock('@/components/PlannerRecipeHandoffCard', () => ({
  PlannerRecipeHandoffCard: 'PlannerRecipeHandoffCard',
}));
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
vi.mock('@/hooks/useMealPlan', () => ({
  mealPlanKeys: { review: (week: string) => ['meal-plans', 'grocery-review', week] },
  formatDateForApi: vi.fn(), formatDayLabel: vi.fn(), formatFullDayLabel: vi.fn(),
  getWeekEnd: vi.fn(), getWeekStart: vi.fn(), isToday: vi.fn(), parseDateFromApi: vi.fn(),
  useUpdateMeal: () => ({ isPending: false, mutateAsync: reviewMocks.update }),
  useAddMeal: vi.fn(), useAddPlanToGrocery: vi.fn(), useDeleteMeal: vi.fn(),
  useMealPlanWeek: vi.fn(),
}));
vi.mock('@/hooks/useRecipes', () => ({ useRecipe: vi.fn() }));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'System' },
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18, xl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { full: 999, sm: 8, md: 12, lg: 16 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/utils/haptics', () => ({
  haptics: {}, lightHaptic: vi.fn(), successHaptic: vi.fn(),
}));
vi.mock('@/lib/plannerNavigation', () => ({
  buildMealPlanEntry: vi.fn(), parsePlannerDateParam: vi.fn(),
  parsePlannerRecipeParam: vi.fn(), plannerGrocerySuccessMessage: vi.fn(),
}));
vi.mock('@/lib/routes', () => ({ appRoutes: {} }));

import PlannerScreen, { MealSlot } from '../app/(tabs)/planner';
import * as planHooks from '@/hooks/useMealPlan';
import { useRecipe } from '@/hooks/useRecipes';

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const colors = {
  card: '#fff', cardBorder: '#ddd', text: '#111', textMuted: '#666',
  tint: '#155c52', warning: '#8a5a00',
} as any;

function entry(
  reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined,
): MealPlanEntry {
  return {
    id: 'entry-1',
    date: '2026-09-06',
    meal_type: 'dinner',
    recipe_id: 'recipe-1',
    recipe_title: 'Chicken Kelaguen',
    recipe_thumbnail: null,
    notes: null,
    servings: null,
    recipe_review_state: reviewState,
    created_at: '2026-09-06T00:00:00Z',
  };
}

async function renderMeal(reviewState: 'needs_review' | 'source_incomplete' | 'ready' | undefined) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => {
    renderer.render(React.createElement(MealSlot, {
      mealType: { type: 'dinner', icon: 'restaurant-outline', label: 'Dinner' },
      entries: [entry(reviewState)],
      colors,
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      onViewRecipe: vi.fn(),
      isAdding: false,
      isAddDisabled: false,
    }));
  });
  return renderer;
}

describe('planner meal readiness', () => {
  it.each([
    ['needs_review', 'Recipe needs review'],
    ['source_incomplete', 'Recipe needs source details'],
  ] as const)('keeps %s warnings on the detail screen', async (state, label) => {
    const renderer = await renderMeal(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === label,
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it.each(['ready', undefined] as const)('hides a badge for %s recipes', async (state) => {
    const renderer = await renderMeal(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel?.startsWith('Recipe needs'),
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

describe('planner loading recovery', () => {
  const refetch = vi.fn();
  beforeEach(() => {
    // 04:30 in Guam: the UTC date is still the previous day.
    vi.useFakeTimers({ now: new Date('2026-10-31T18:30:00Z'), toFake: ['Date'] });
    routeMocks.params = {}; routeMocks.scrollTo.mockClear();
    refetch.mockReset().mockResolvedValue({});
    vi.mocked(planHooks.getWeekStart).mockImplementation((date) => date);
    vi.mocked(planHooks.getWeekEnd).mockImplementation((date) => date);
    vi.mocked(planHooks.formatDateForApi).mockImplementation(localDate);
    vi.mocked(planHooks.formatDayLabel).mockReturnValue({ day: 'Wed', number: '14' });
    vi.mocked(useRecipe).mockReturnValue({} as any);
    for (const hook of [planHooks.useAddMeal, planHooks.useDeleteMeal, planHooks.useAddPlanToGrocery]) {
      vi.mocked(hook).mockReturnValue({ isPending: false } as any);
    }
  });

  afterEach(() => vi.useRealTimers());

  it('scrolls to another requested day in the same week using its recorded layout', async () => {
    const start = new Date('2026-10-26T12:00:00Z');
    vi.mocked(planHooks.getWeekStart).mockReturnValue(start);
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data: { days: [] }, refetch } as any);
    const { parsePlannerDateParam } = await import('@/lib/plannerNavigation');
    vi.mocked(parsePlannerDateParam).mockImplementation(value => value ? new Date(`${value}T12:00:00Z`) : null);
    routeMocks.params = { date: '2026-10-26' };
    const root = createRoot();
    try {
      await act(async () => root.render(<PlannerScreen />));
      const days = root.container.queryAll(node => node.type === 'View' && !!node.props.onLayout);
      expect(days).toHaveLength(7);
      await act(async () => days.forEach((day, index) => day.props.onLayout({ nativeEvent: { layout: { y: 100 + index * 200 } } })));
      routeMocks.scrollTo.mockClear();
      routeMocks.params = { date: '2026-10-28' };
      await act(async () => root.render(<PlannerScreen />));
      expect(routeMocks.scrollTo).toHaveBeenCalledWith({ y: 396, animated: false });
    } finally { routeMocks.params = {}; vi.mocked(parsePlannerDateParam).mockReset(); await act(async () => root.unmount()); }
  });

  it('adds a picked recipe to the chosen day instead of a previously focused day', async () => {
    const start = new Date('2026-10-26T12:00:00Z');
    vi.mocked(planHooks.getWeekStart).mockReturnValue(start);
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data: { days: [] }, refetch } as any);
    const add = vi.fn().mockResolvedValue({});
    vi.mocked(planHooks.useAddMeal).mockReturnValue({ isPending: false, mutateAsync: add } as any);
    const { buildMealPlanEntry } = await import('@/lib/plannerNavigation');
    vi.mocked(buildMealPlanEntry).mockImplementation((recipe, date, type) => ({ recipe_id: recipe.id, date, meal_type: type }) as any);
    const root = createRoot();
    try {
      await act(async () => root.render(<PlannerScreen />));
      const dinners = root.container.queryAll(node => node.props.accessibilityLabel?.startsWith('Add meal for '));
      expect(dinners).toHaveLength(7);
      await act(async () => dinners[1].props.onPress());
      const { ActionSheetIOS } = await import('react-native');
      const [options, choose] = vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock.calls.at(-1)!;
      await act(async () => choose(options.options.indexOf('Dinner')));
      const picker = root.container.queryAll(node => node.type === 'RecipePickerModal')[0];
      await act(async () => picker.props.onSelect({ id: 'picked-recipe', title: 'Rice' }));
      const date = planHooks.formatDateForApi(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1));
      expect(add).toHaveBeenCalledWith({ recipe_id: 'picked-recipe', date, meal_type: 'dinner' });
    } finally { await act(async () => root.unmount()); }
  });

  it('shows a retry instead of empty meal slots after initial load fails', async () => {
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ isError: true, refetch } as any);
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<PlannerScreen />));
      expect(renderer.container.queryAll((node) => node.props.children === 'Couldn’t load your meal plan')).toHaveLength(1);
      expect(renderer.container.queryAll((node) => node.props.accessibilityLabel === 'Add Dinner')).toHaveLength(0);
      await act(async () => renderer.container.queryAll((node) => node.props.title === 'Try again')[0].props.onPress());
      expect(refetch).toHaveBeenCalledOnce();
    } finally { await act(async () => renderer.unmount()); }
  });

  it('persists edited entry servings only after the entry form Save', async () => {
    const meal = entry('ready');
    const date = localDate(new Date());
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data: { days: [{ date, dinner: [meal] }] }, refetch } as any);
    reviewMocks.update.mockClear();
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<PlannerScreen />));
      await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Edit servings for Chicken Kelaguen')[0].props.onPress());
      await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Planned servings')[0].props.onChangeText('6'));
      expect(reviewMocks.update).not.toHaveBeenCalled();
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Save servings')[0].props.onPress());
      expect(reviewMocks.update).toHaveBeenCalledWith({ entryId: meal.id, update: { planned_servings: 6 } });
    } finally { await act(async () => renderer.unmount()); }
  });

  it('reviews week totals and missing amounts before sending a replay-safe addition', async () => {
    const meal = entry('ready');
    const date = localDate(new Date());
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data: { days: [{ date, dinner: [meal] }] }, refetch } as any);
    vi.mocked(planHooks.useAddPlanToGrocery).mockReturnValue({ mutateAsync: reviewMocks.add } as any);
    reviewMocks.state = { data: { list_id: 'household-a', preview_token: 'review-token', items_added: 2, items_missing_amount: 1, items_unscaled: 0,
      totals: [{ name: 'Rice', quantity: '3', unit: 'cup', missing: 1, uncombined: 0 }],
      items: [{ name: 'Rice', quantity: '3', unit: 'cup', recipe_title: 'Chicken Kelaguen' }] } };
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<PlannerScreen />));
      expect(reviewMocks.add).not.toHaveBeenCalled();
      await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Review week groceries')[0].props.onPress());
      expect(reviewMocks.add).not.toHaveBeenCalled();
      expect(renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')).toHaveLength(1);
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')[0].props.onPress());
      expect(reviewMocks.add).toHaveBeenCalledWith(expect.objectContaining({ review: expect.objectContaining({ list_id: 'household-a', preview_token: 'review-token', mutation_id: 'request-id' }) }));
    } finally { reviewMocks.state = {}; await act(async () => renderer.unmount()); }
  });
  it('retains the exact reviewed request after a lost response and changed review data', async () => {
    reviewMocks.add.mockClear();
    const meal = entry('ready');
    reviewMocks.add.mockRejectedValueOnce(new Error('Network Error'));
    const date = localDate(new Date());
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data: { days: [{ date, dinner: [meal] }] }, refetch } as any);
    vi.mocked(planHooks.useAddPlanToGrocery).mockReturnValue({ mutateAsync: reviewMocks.add } as any);
    reviewMocks.state = { data: { list_id: 'household-a', preview_token: 'review-token', items_added: 2, items_missing_amount: 1, items_unscaled: 0,
      totals: [{ name: 'Rice', quantity: '3', unit: 'cup', missing: 1, uncombined: 0 }],
      items: [{ name: 'Rice', quantity: '3', unit: 'cup', recipe_title: 'Chicken Kelaguen' }] } };
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<PlannerScreen />));
      expect(reviewMocks.add).not.toHaveBeenCalled();
      await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Review week groceries')[0].props.onPress());
      expect(reviewMocks.add).not.toHaveBeenCalled();
      expect(renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')).toHaveLength(1);
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')[0].props.onPress());
      const first = reviewMocks.add.mock.calls.at(-1)![0];
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Close review')[0].props.onPress());
      reviewMocks.state = { ...reviewMocks.state, data: { ...reviewMocks.state.data, list_id: 'household-b', preview_token: 'changed' } };
      await act(async () => renderer.render(React.createElement(PlannerScreen)));
      await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Review week groceries')[0].props.onPress());
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')[0].props.onPress());
      expect(reviewMocks.add.mock.calls.at(-1)![0]).toEqual(first);
      expect(reviewMocks.add).toHaveBeenCalledWith(expect.objectContaining({ review: expect.objectContaining({ list_id: 'household-a', preview_token: 'review-token', mutation_id: 'request-id' }) }));
    } finally { reviewMocks.state = {}; await act(async () => renderer.unmount()); }
  });
  it('clears an ambiguous review when the authenticated account changes', async () => {
    reviewMocks.add.mockClear();
    const meal = entry('ready');
    reviewMocks.add.mockRejectedValueOnce(new Error('Network Error'));
    const date = localDate(new Date());
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data: { days: [{ date, dinner: [meal] }] }, refetch } as any);
    vi.mocked(planHooks.useAddPlanToGrocery).mockReturnValue({ mutateAsync: reviewMocks.add } as any);
    reviewMocks.state = { data: { list_id: 'household-a', preview_token: 'review-token', items_added: 2, items_missing_amount: 1, items_unscaled: 0,
      totals: [{ name: 'Rice', quantity: '3', unit: 'cup', missing: 1, uncombined: 0 }],
      items: [{ name: 'Rice', quantity: '3', unit: 'cup', recipe_title: 'Chicken Kelaguen' }] } };
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<PlannerScreen />));
      expect(reviewMocks.add).not.toHaveBeenCalled();
      await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Review week groceries')[0].props.onPress());
      expect(reviewMocks.add).not.toHaveBeenCalled();
      expect(renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')).toHaveLength(1);
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')[0].props.onPress());
      const first = reviewMocks.add.mock.calls.at(-1)![0];
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Close review')[0].props.onPress());
      reviewMocks.session = 'session-b';
      reviewMocks.state = { ...reviewMocks.state, data: { ...reviewMocks.state.data, list_id: 'household-b', preview_token: 'changed' } };
      await act(async () => renderer.render(React.createElement(PlannerScreen)));
      await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Review week groceries')[0].props.onPress());
      await act(async () => renderer.container.queryAll(node => node.props.title === 'Add reviewed groceries')[0].props.onPress());
      expect(reviewMocks.add.mock.calls.at(-1)![0]).not.toEqual(first);
      expect(reviewMocks.add.mock.calls.at(-1)![0].review.list_id).toBe('household-b');
      expect(reviewMocks.add).toHaveBeenCalledWith(expect.objectContaining({ review: expect.objectContaining({ list_id: 'household-a', preview_token: 'review-token', mutation_id: 'request-id' }) }));
    } finally { reviewMocks.session = 'session-a'; reviewMocks.state = {}; await act(async () => renderer.unmount()); }
  });

  it('keeps cached meals visible after a refresh error and clears the warning on success', async () => {
    const meal = entry('ready');
    const date = localDate(new Date());
    const data = { days: [{ date, dinner: [meal] }] };
    vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data, isError: true, refetch } as any);
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<PlannerScreen />));
      expect(renderer.container.queryAll((node) => node.props.children === 'Chicken Kelaguen')).toHaveLength(1);
      expect(renderer.container.queryAll((node) => node.props.children === 'Couldn’t refresh your meal plan')).toHaveLength(1);
      vi.mocked(planHooks.useMealPlanWeek).mockReturnValue({ data, isError: false, refetch } as any);
      await act(async () => renderer.render(<PlannerScreen />));
      expect(renderer.container.queryAll((node) => node.props.children === 'Couldn’t refresh your meal plan')).toHaveLength(0);
    } finally { await act(async () => renderer.unmount()); }
  });
});

it('makes planned servings editable on an entry', async () => {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  const selected = { ...entry('ready'), planned_servings: 8 };
  const onEdit = vi.fn();
  try {
    await act(async () => renderer.render(<MealSlot mealType={{ type: 'dinner', label: 'Dinner', icon: 'restaurant-outline' }}
      entries={[selected]} colors={colors} onAdd={vi.fn()} onRemove={vi.fn()} onViewRecipe={vi.fn()}
      onEditServings={onEdit} isAdding={false} isAddDisabled={false} />));
    await act(async () => renderer.container.queryAll(node => node.props.accessibilityLabel === 'Edit servings for Chicken Kelaguen')[0].props.onPress());
    expect(onEdit).toHaveBeenCalledWith(selected);
    expect(renderer.container.queryAll(node => Array.isArray(node.props.children) && node.props.children[0] === '8 servings')).toHaveLength(1);
  } finally { await act(async () => renderer.unmount()); }
});


it('gives the recipe title its own 44pt target, separate from servings and removal', async () => {
  const root = createRoot();
  const onView = vi.fn(), onEdit = vi.fn(), onRemove = vi.fn();
  const meal = entry('ready');
  try {
    await act(async () => root.render(<MealSlot mealType={{ type: 'dinner', label: 'Dinner', icon: 'restaurant-outline' }}
      entries={[meal]} colors={colors} onAdd={vi.fn()} onRemove={onRemove} onViewRecipe={onView}
      onEditServings={onEdit} isAdding={false} isAddDisabled={false} />));
    const title = root.container.queryAll(node => node.props.accessibilityLabel === 'Open Chicken Kelaguen')[0];
    expect(title.props.style.minHeight).toBeGreaterThanOrEqual(44);
    await act(async () => title.props.onPress());
    expect(onView).toHaveBeenCalledWith('recipe-1');
    expect(onEdit).not.toHaveBeenCalled(); expect(onRemove).not.toHaveBeenCalled();
    await act(async () => root.container.queryAll(node => node.props.accessibilityLabel === 'Edit servings for Chicken Kelaguen')[0].props.onPress());
    expect(onEdit).toHaveBeenCalledWith(meal);
    await act(async () => root.container.queryAll(node => node.props.accessibilityLabel === 'Remove Chicken Kelaguen from Dinner')[0].props.onPress());
    expect(onRemove).toHaveBeenCalledWith('entry-1');
    expect(onView).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

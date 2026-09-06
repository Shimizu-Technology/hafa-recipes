import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { MealPlanEntry } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Dimensions: { get: () => ({ width: 390 }) },
  Image: 'Image',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
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
  formatDateForApi: vi.fn(), formatDayLabel: vi.fn(), formatFullDayLabel: vi.fn(),
  getWeekEnd: vi.fn(), getWeekStart: vi.fn(), isToday: vi.fn(), parseDateFromApi: vi.fn(),
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

import { MealSlot } from '../app/(tabs)/planner';

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
  ] as const)('renders %s on planned recipes', async (state, label) => {
    const renderer = await renderMeal(state);
    try {
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === label,
      )).toHaveLength(1);
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

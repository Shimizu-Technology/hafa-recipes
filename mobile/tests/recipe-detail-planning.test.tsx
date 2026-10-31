vi.mock('@react-native-async-storage/async-storage', () => { const values = new Map<string, string>(); return { default: {
 getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); },
 getAllKeys: async () => [...values.keys()], multiRemove: async (keys: string[]) => keys.forEach(key => values.delete(key)),
} }; });
import Colors from '../constants/Colors';
import { offlineRecipes } from '../lib/offlineRecipes';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({ unavailable: false, servings: null as number | null, scaled: 1, theme: 'dark' as 'light' | 'dark', activeTab: 'ingredients', push: vi.fn() }));
function host(name: string) { return (props: any) => React.createElement(name, props, props.children); }
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: any) => value }, Platform: { OS: 'ios' },
  ScrollView: host('ScrollView'), TouchableOpacity: host('TouchableOpacity'),
  View: host('View'), ActivityIndicator: host('ActivityIndicator'), Modal: host('Modal'),
  KeyboardAvoidingView: host('KeyboardAvoidingView'), Pressable: host('Pressable'),
  Alert: { alert: vi.fn() }, Share: {}, ActionSheetIOS: {}, Keyboard: {},
}));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'recipe-id' }),
  useRouter: () => ({ push: m.push }), Stack: { Screen: () => null } }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'owner', isLoaded: true }), useUser: () => ({ user: {} }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Icon') }));
vi.mock('@/components/Themed', () => ({ Text: host('Text'), View: host('View'), Card: host('Card'), Chip: host('Chip'), Divider: host('Divider'), useColors: () => Colors[m.theme] }));
vi.mock('@/components/NutritionPanel', () => ({ NutritionPanel: () => null }));
vi.mock('@/components/RecipeDetailsReview', () => ({ RecipeDetailsReview: () => null }));
vi.mock('@/components/AddIngredientsModal', () => ({ default: () => null }));
vi.mock('@/components/RecipeChatModal', () => ({ default: () => null }));
vi.mock('@/components/AddToCollectionModal', () => ({ default: () => null }));
vi.mock('@/components/RecipeOrganizer', () => ({ RecipeOrganizer: host('RecipeOrganizer') }));
vi.mock('@/components/RecipeHero', () => ({ RecipeHero: () => null }));
vi.mock('@/components/RecipeDetailPreview', () => ({ RecipeDetailPreview: () => null }));
vi.mock('@/components/VersionHistoryModal', () => ({ default: () => null }));
vi.mock('@/components/SafetyActionModal', () => ({ SafetyActionModal: () => null }));
vi.mock('@/components/Skeleton', () => ({ SkeletonSimilarRecipes: () => null }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: () => null }));
vi.mock('@/hooks/useNutritionRefresh', () => ({ useNutritionRefresh: () => ({}) }));
vi.mock('@/hooks/useRecipeTabScroll', () => ({ useRecipeTabScroll: () => ({ activeTab: m.activeTab, scrollRef: { current: null } }) }));
vi.mock('@/hooks/useTextSize', () => ({ useTextSize: () => ({ scaleFontSize: (value: number) => value }) }));
vi.mock('@/hooks/useScaledServings', () => ({ useScaledServings: () => ({ currentServings: m.scaled, scaleFactor: m.servings ? m.scaled / m.servings : 1, isScaled: !!m.servings && m.scaled !== m.servings }), scaleQuantity: (value: unknown) => value, scaleIngredient: (value: unknown) => value }));
vi.mock('@/hooks/useRecipeDeletion', () => ({ useRecipeDeletion: () => vi.fn() }));
vi.mock('@/hooks/useGrocery', () => ({ useAddFromRecipe: () => ({}) }));
vi.mock('@/hooks/useCollections', () => ({ useCollections: () => ({ data: [] }), useRecipeCollections: () => ({ data: [] }) }));
vi.mock('@/hooks/useMealPlan', () => ({ useRecipeMealPlanEntries: () => ({ data: [] }) }));
vi.mock('@/hooks/usePublishingDisclosure', () => ({ usePublishingDisclosure: () => ({}) }));
vi.mock('@/hooks/useCommunitySafety', () => ({ useBlockContributor: () => ({}), useCreateSafetyAppeal: () => ({}), useCreateSafetyReport: () => ({}) }));
vi.mock('@/contexts/ExtractionContext', () => ({ useAsyncExtraction: () => ({}) }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/lib/openRecipeSource', () => ({ openRecipeSource: vi.fn() }));
vi.mock('@/utils/haptics', () => ({ haptics: {} }));
vi.mock('@/hooks/useRecipes', () => ({
  useRecipe: () => ({ data: m.unavailable ? undefined : { id: 'recipe-id', source_type: 'manual', source_url: 'manual:recipe',
    is_owner: true, is_public: false, review_state: 'ready', content_revision: 1,
    extracted: { title: 'Rice', servings: m.servings, totalEstimatedCost: 12, tags: [], times: {},
      components: [{ name: 'Main', ingredients: [{ name: 'rice', quantity: '1', unit: 'cup' }], steps: ['Cook'] }] } } }),
  useToggleRecipeSharing: () => ({}), useIsRecipeSaved: () => ({}), useSaveRecipe: () => ({}),
  useUnsaveRecipe: () => ({}), useRecipeNote: () => ({}), useUpdateRecipeNote: () => ({}), useSimilarRecipes: () => ({ data: [] }),
}));
import RecipeDetailScreen from '../app/recipe/[id]';

it.each([[null, 1, undefined], [4, 8, '8'], [1, 1, '1']] as const)(
  'plans from the actual detail organizer without inventing servings (source=%s, scaled=%s)',
  async (servings, scaled, expected) => {
    m.servings = servings; m.scaled = scaled; m.push.mockClear();
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(React.createElement(RecipeDetailScreen)));
      const organizer = renderer.container.queryAll(node => node.type === 'RecipeOrganizer')[0];
      await act(async () => organizer.props.onPlanRecipe());
      const route = m.push.mock.calls.at(-1)![0];
      expect(route.params.recipeId).toBe('recipe-id');
      expect(route.params.servings).toBe(expected);
      if (expected === undefined) expect(route.params).not.toHaveProperty('servings');
    } finally { await act(async () => renderer.unmount()); }
  },
);

it('retires the mounted detail contents when the same subject changes stable owner', async () => {
  await offlineRecipes.bindSubject('detail-subject'); await offlineRecipes.verify('detail-subject', 'owner-a');
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailScreen />));
    expect(root.container.queryAll(node => node.props.children === 'Rice').length).toBeGreaterThan(0);
    m.unavailable = true;
    await act(async () => { await offlineRecipes.verify('detail-subject', 'owner-b'); });
    expect(root.container.queryAll(node => node.props.children === 'Rice')).toHaveLength(0);
  } finally { await act(async () => root.unmount()); m.unavailable = false; await offlineRecipes.clear(); }
});

function effectiveStyle(style: any): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(effectiveStyle)) : style || {};
}

it.each(['light', 'dark'] as const)('uses readable tint foregrounds for detail steps, cost and cooking in %s mode', async theme => {
  m.theme = theme; m.servings = 4; m.scaled = 8; m.activeTab = 'steps';
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailScreen />));
    const stepNumber = root.container.queryAll(node => node.type === 'Text' && node.props.children === 1);
    expect(stepNumber).toHaveLength(1);
    expect(effectiveStyle(stepNumber[0].props.style).color).toBe(Colors[theme].onTint);
    const cookIcon = root.container.queryAll(node => node.type === 'Icon' && node.props.name === 'restaurant');
    expect(cookIcon).toHaveLength(1);
    expect(cookIcon[0].props.color).toBe(Colors[theme].onTint);
    const cookLabel = root.container.queryAll(node => node.type === 'Text' && node.props.children === 'Start Cooking');
    expect(cookLabel).toHaveLength(1);
    expect(effectiveStyle(cookLabel[0].props.style).color).toBe(Colors[theme].onTint);
    m.activeTab = 'cost';
    await act(async () => root.render(<RecipeDetailScreen />));
    const totalBox = root.container.queryAll(node => node.type === 'View' &&
      Array.isArray(node.props.children) && node.props.children.some((child: any) => child?.props?.children === 'Estimated Total Cost'));
    expect(totalBox).toHaveLength(1);
    const costLabels = totalBox[0].props.children.filter(Boolean);
    expect(costLabels).toHaveLength(3);
    for (const label of costLabels) expect(effectiveStyle(label.props.style).color).toBe(Colors[theme].onTint);
  } finally {
    await act(async () => root.unmount());
    m.theme = 'dark'; m.activeTab = 'ingredients'; m.servings = null; m.scaled = 1;
  }
});

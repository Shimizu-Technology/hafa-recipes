vi.mock('@/components/OfflineRecipeControl', () => ({ OfflineRecipeControl: () => null }));
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
const m = vi.hoisted(() => ({ tags: [] as string[], times: {} as Record<string, string>, isPublic: false, moderationStatus: null as string | null, unavailable: false, revision: 1, servings: null as number | null, scaled: 1, theme: 'dark' as 'light' | 'dark', activeTab: 'ingredients', totalEstimatedCost: 12, push: vi.fn() }));
function host(name: string) { return (props: any) => React.createElement(name, props, props.children); }
vi.mock('react-native', () => ({
  useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1, scale: 3 }),
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
vi.mock('@/components/OfflineRecipeControl', () => ({ OfflineRecipeControl: () => null }));
vi.mock('@/components/Themed', () => ({ Button: host('Button'), Text: host('Text'), View: host('View'), Card: host('Card'), Chip: host('Chip'), Divider: host('Divider'), useColors: () => Colors[m.theme] }));
vi.mock('@/components/NutritionPanel', () => ({ NutritionPanel: host('NutritionPanel') }));
vi.mock('@/components/RecipeDetailsReview', () => ({ RecipeDetailsReview: () => null }));
vi.mock('@/components/AddIngredientsModal', () => ({ default: () => null }));
vi.mock('@/components/RecipeChatModal', () => ({ default: () => null }));
vi.mock('@/components/AddToCollectionModal', () => ({ default: () => null }));
vi.mock('@/components/RecipeOrganizer', () => ({ RecipeOrganizer: host('RecipeOrganizer') }));
vi.mock('@/components/RecipeHero', () => ({ RecipeHero: () => null }));
vi.mock('@/components/RecipeDetailChrome', () => ({
  RecipeDetailScroll: (props: any) => React.createElement('RecipeDetailScroll', props, props.hero, props.children),
  RecipeDetailFrame: host('RecipeDetailFrame'),
}));
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
vi.mock('@/utils/haptics', () => ({ haptics: { selection: vi.fn() } }));
vi.mock('@/hooks/useRecipes', () => ({
  useRecipe: () => ({ data: m.unavailable ? undefined : { id: 'recipe-id', source_type: 'manual', source_url: 'manual:recipe',
    is_owner: true, is_public: m.isPublic, moderation_status: m.moderationStatus, review_state: 'ready', content_revision: m.revision,
    extracted: { title: 'Rice', servings: m.servings, totalEstimatedCost: m.totalEstimatedCost, tags: m.tags, times: m.times,
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


it('checks ingredients independently and keeps the main Plan action scaled', async () => {
  m.servings = 4; m.scaled = 8; m.push.mockClear();
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailScreen />));
    const checkbox = () => root.container.queryAll(node => node.type === 'TouchableOpacity' && node.props.accessibilityRole === 'checkbox')[0];
    expect(checkbox().props.accessibilityState.checked).toBe(false);
    await act(async () => checkbox().props.onPress());
    expect(checkbox().props.accessibilityState.checked).toBe(true);
    m.revision += 1;
    await act(async () => root.render(<RecipeDetailScreen />));
    expect(checkbox().props.accessibilityState.checked).toBe(false);
    await act(async () => checkbox().props.onPress());
    await act(async () => checkbox().props.onPress());
    expect(checkbox().props.accessibilityState.checked).toBe(false);
    const plan = root.container.queryAll(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Plan')[0];
    await act(async () => plan.props.onPress());
    expect(m.push.mock.calls.at(-1)?.[0].params.servings).toBe('8');
  } finally { await act(async () => root.unmount()); }
});


it('unmounts collapsed nutrition while retaining the chosen basis across reopening', async () => {
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailScreen />));
    const panels = () => root.container.queryAll(node => node.type === 'NutritionPanel');
    const toggle = () => root.container.queryAll(node => node.type === 'TouchableOpacity' &&
      node.props.accessibilityLabel === 'Nutrition')[0];
    expect(panels()).toHaveLength(0);
    await act(async () => toggle().props.onPress());
    expect(panels()).toHaveLength(1);
    const order = root.container.queryAll(node => node.type === 'NutritionPanel' ||
      node.type === 'TouchableOpacity' && ['Nutrition', 'Cost'].includes(node.props.accessibilityLabel));
    expect(order.map(node => node.type === 'NutritionPanel' ? 'panel' : node.props.accessibilityLabel)).toEqual(['Nutrition', 'panel', 'Cost']);
    await act(async () => panels()[0].props.onBasisChange('whole-recipe'));
    await act(async () => toggle().props.onPress());
    expect(panels()).toHaveLength(0);
    await act(async () => toggle().props.onPress());
    expect(panels()[0].props.selectedBasisId).toBe('whole-recipe');
  } finally { await act(async () => root.unmount()); }
});


it.each([
  [true, null, 'On'],
  [false, null, 'Off'],
  [true, 'hidden', 'Under review'],
] as const)('shows honest Discover visibility (public=%s, moderation=%s)', async (isPublic, status, value) => {
  m.isPublic = isPublic; m.moderationStatus = status;
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailScreen />));
    // Assert the rendered Text, rather than only the VoiceOver label.
    expect(root.container.queryAll(node => node.type === 'Text' && node.props.children === value)).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    m.isPublic = false; m.moderationStatus = null;
  }
});

function effectiveStyle(style: any): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(effectiveStyle)) : style || {};
}

it.each(['light', 'dark'] as const)('keeps neutral steps and readable cost foregrounds in %s mode', async theme => {
  m.theme = theme; m.servings = 4; m.scaled = 8;
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailScreen />));
    const stepNumber = root.container.queryAll(node => node.type === 'Text' && node.props.children === 1);
    expect(stepNumber).toHaveLength(1);
    expect(effectiveStyle(stepNumber[0].props.style).color).toBe(Colors[theme].textSecondary);
    // Start cooking is the one full-width primary action; there is no floating dock.
    expect(root.container.queryAll(node => node.type === 'Button' && node.props.title === 'Start cooking')).toHaveLength(1);
    const cost = root.container.queryAll(node => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === 'Cost')[0];
    await act(async () => cost.props.onPress());
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

it('shows only known facts, readable tags, and Scale only when servings are known', async () => {
  const texts = (root: ReturnType<typeof createRoot>) => root.container.queryAll(node => node.type === 'Text')
    .map(node => [node.props.children].flat().join(''));
  const scale = (root: ReturnType<typeof createRoot>) => root.container.queryAll(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Scale');
  m.servings = null; m.scaled = 1; m.times = {}; m.tags = ['peanut-butter-cookies', 'easy'];
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailScreen />));
    expect(texts(root).some(text => text.includes('—'))).toBe(false);
    expect(root.container.queryAll(node => node.props.accessibilityLabel?.startsWith?.('Tags:'))[0].props.accessibilityLabel)
      .toBe('Tags: Peanut butter cookies, Easy');
    expect(scale(root)).toHaveLength(0);
    m.servings = 4; m.scaled = 4; m.times = { total: '25 min' };
    await act(async () => root.render(<RecipeDetailScreen />));
    expect(root.container.queryAll(node => node.props.accessibilityLabel === '25 min total')).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === '4 servings')).toHaveLength(1);
    expect(scale(root)).toHaveLength(1);
  } finally { await act(async () => root.unmount()); m.tags = []; m.times = {}; }
});

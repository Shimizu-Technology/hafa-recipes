import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  editRecipe: vi.fn(), close: vi.fn(), alert: vi.fn(), setQueryData: vi.fn(), invalidateQueries: vi.fn(),
  mutationOptions: [] as Array<{ onSuccess?: (recipe: Recipe) => void }>,
  editorRecipe: null as Recipe | null, editorSubmit: vi.fn(), owner: 'owner-a', routeId: 'r1',
}));
vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) => ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Alert: { alert: mocks.alert }, KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Modal: host('Modal'), Platform: { OS: 'ios' }, ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles }, TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'), View: host('View'),
    ActivityIndicator: host('ActivityIndicator'), Image: host('Image'), Keyboard: { dismiss: vi.fn() },
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: mocks.setQueryData, invalidateQueries: mocks.invalidateQueries }),
  useQuery: (options: { queryKey: string[] }) => options.queryKey[0] === 'recipe'
    ? { data: mocks.editorRecipe, isLoading: !mocks.editorRecipe }
    : { data: { has_original: false } },
  useMutation: (options: { onSuccess?: (recipe: Recipe) => void }) => { mocks.mutationOptions.push(options); return { mutate: mocks.editorSubmit, isPending: false }; },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: mocks.owner, isLoaded: true }) }));
vi.mock('expo-router', async () => {
  const ReactModule = await import('react');
  return {
    useRouter: () => ({ back: mocks.close }), useLocalSearchParams: () => ({ id: mocks.routeId }),
    Stack: { Screen: ({ options }: any) => ReactModule.createElement('StackScreen', {}, options.headerRight?.()) },
  };
});
vi.mock('expo-image-picker', () => ({}));
vi.mock('@/components/NutritionPanel', () => ({ NutritionPanel: () => null }));
vi.mock('@/hooks/usePublishingDisclosure', () => ({ usePublishingDisclosure: () => ({ requestPublishing: vi.fn(), isCheckingDisclosure: false }) }));
vi.mock('@/lib/api', () => ({ api: { editRecipe: mocks.editRecipe } }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  return {
    Text: (props: Record<string, unknown>) => ReactModule.createElement('Text', props, props.children as React.ReactNode),
    Button: (props: Record<string, unknown>) => ReactModule.createElement('Button', props),
    View: (props: Record<string, unknown>) => ReactModule.createElement('View', props, props.children as React.ReactNode),
    useColors: () => ({ tint: '#37745B', text: '#222', textSecondary: '#555', background: '#fff', backgroundSecondary: '#eee', border: '#ccc' }),
  };
});
import { RecipeDetailsReview } from '@/components/RecipeDetailsReview';
import EditRecipeScreen from '../app/edit-recipe/[id]';

describe('recipe editor draft preservation', () => {
  it('keeps unsaved scalar, ingredient, and step edits when a foreground refetch replaces the recipe object', async () => {
    mocks.editorRecipe = { ...recipe, is_public: false };
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<EditRecipeScreen />); });
    try {
      const input = (placeholder: string) => host(tree, 'TextInput', props => props.placeholder === placeholder)[0];
      await act(async () => {
        input('Recipe name').props.onChangeText('My rice');
        input('Ingredient name').props.onChangeText('Brown rice');
        input('Describe this step...').props.onChangeText('Simmer gently.');
        input('Additional notes, tips, or variations...').props.onChangeText('My private draft');
      });
      mocks.editorRecipe = { ...structuredClone(recipe), thumbnail_url: 'https://example.test/new-cover.webp', is_public: false };
      await act(async () => tree.update(<EditRecipeScreen />));
      expect(input('Recipe name').props.value).toBe('My rice');
      expect(input('Ingredient name').props.value).toBe('Brown rice');
      expect(input('Describe this step...').props.value).toBe('Simmer gently.');
      expect(input('Additional notes, tips, or variations...').props.value).toBe('My private draft');
      await act(async () => host(tree, 'TouchableOpacity')[0].props.onPress());
      expect(mocks.editorSubmit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        title: 'My rice', review_content_revision: 5,
      }) }));
    } finally { await act(async () => tree.unmount()); }
  });
  it('keeps a draft when a newer content revision arrives and reloads only after confirmation', async () => {
    mocks.editorRecipe = { ...recipe, is_public: false };
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<EditRecipeScreen />); });
    try {
      const title = () => host(tree, 'TextInput', props => props.placeholder === 'Recipe name')[0];
      await act(async () => title().props.onChangeText('Unsaved title'));
      mocks.editorRecipe = { ...structuredClone(recipe), is_public: false, content_revision: 6,
        extracted: { ...recipe.extracted, title: 'Updated rice' } };
      await act(async () => tree.update(<EditRecipeScreen />));
      expect(title().props.value).toBe('Unsaved title');
      await act(async () => host(tree, 'TouchableOpacity')[0].props.onPress());
      expect(mocks.editorSubmit).not.toHaveBeenCalled();
      expect(mocks.alert).toHaveBeenCalledWith('Recipe changed', expect.any(String));
      await act(async () => host(tree, 'TouchableOpacity', props => props.accessibilityLabel === 'Reload latest recipe')[0].props.onPress());
      expect(title().props.value).toBe('Unsaved title');
      const confirmation = mocks.alert.mock.calls.at(-1)![2];
      await act(async () => confirmation.find((option: any) => option.text === 'Reload').onPress());
      expect(title().props.value).toBe('Updated rice');
      await act(async () => host(tree, 'TouchableOpacity')[0].props.onPress());
      expect(mocks.editorSubmit.mock.calls.at(-1)![0].data.review_content_revision).toBe(6);
    } finally { await act(async () => tree.unmount()); }
  });
  it.each(['save', 'restore'] as const)('refreshes connected caches after accepted %s completes on an unmounted editor, without stale UI', async operation => {
    mocks.editorRecipe = { ...recipe, is_public: false };
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<EditRecipeScreen />); });
    const options = mocks.mutationOptions.at(operation === 'save' ? -2 : -1)!;
    await act(async () => tree.unmount());
    mocks.invalidateQueries.mockClear(); mocks.alert.mockClear(); mocks.close.mockClear();
    await act(async () => options.onSuccess?.(recipe));
    for (const queryKey of [['recipes'], ['recipe', 'r1'], ['recipe-original', 'r1'], ['recipeVersions', 'list', 'r1'], ['recipeVersions', 'count', 'r1']]) {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey });
    }
    expect(mocks.alert).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  });
  it('starts a separate form when the recipe or account changes', async () => {
    mocks.editorRecipe = { ...recipe, is_public: false };
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<EditRecipeScreen />); });
    try {
      const title = () => host(tree, 'TextInput', props => props.placeholder === 'Recipe name')[0];
      await act(async () => title().props.onChangeText('Private first draft'));
      mocks.routeId = 'r2';
      mocks.editorRecipe = { ...recipe, id: 'r2', extracted: { ...recipe.extracted, title: 'Beans' } };
      await act(async () => tree.update(<EditRecipeScreen />));
      expect(title().props.value).toBe('Beans');
      await act(async () => title().props.onChangeText('Private second draft'));
      mocks.owner = 'owner-b';
      mocks.editorRecipe = { ...recipe, id: 'r2', extracted: { ...recipe.extracted, title: 'New account recipe' } };
      await act(async () => tree.update(<EditRecipeScreen />));
      expect(title().props.value).toBe('New account recipe');
    } finally { await act(async () => tree.unmount()); }
  });
});

const recipe = {
  id: 'r1', content_revision: 5, is_public: true, review_state: 'needs_review',
  extracted: { title: 'Rice', servings: 4, times: {}, tags: [], components: [{ name: 'Main', steps: ['Combine.', 'Cook.'], ingredients: [
    { name: 'Rice', quantity: '2', unit: 'cups' }, { name: 'Water', quantity: null, unit: 'cups' },
  ] }] },
  extraction_evidence: { version: 2, assessment: { issues: [{ code: 'missing_quantity', path: 'components.0.ingredients.1.quantity', message: 'Amount not stated.' }] } },
} as unknown as Recipe;

async function render(inputRecipe = recipe) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<RecipeDetailsReview recipe={inputRecipe} onClose={mocks.close} onEdit={() => {}} />); });
  return tree;
}
function host(tree: ReactTestRenderer, type: string, predicate: (props: any) => boolean = () => true) {
  return tree.root.findAll(node => node.type === type && predicate(node.props));
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.mutationOptions = []; mocks.editRecipe.mockResolvedValue({ ...recipe, review_state: 'ready' });
  mocks.editorRecipe = structuredClone(recipe); mocks.owner = 'owner-a'; mocks.routeId = 'r1';
});

describe('optional saved recipe review', () => {
  it('shows just the uncertain amount and allows leaving with no mutation', async () => {
    const tree = await render();
    expect(host(tree, 'TextInput')).toHaveLength(1);
    expect(host(tree, 'TextInput')[0].props.accessibilityLabel).toBe('Amount for Water');
    await act(async () => { host(tree, 'Button', props => props.title === 'Done')[0].props.onPress(); });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.editRecipe).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
  it('saves a correction without checking title, instructions, or other ingredients', async () => {
    const tree = await render();
    await act(async () => { host(tree, 'TextInput')[0].props.onChangeText('3'); });
    await act(async () => { host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress(); });
    expect(mocks.editRecipe).toHaveBeenCalledWith('r1', expect.objectContaining({
      review_content_revision: 5, verified_paths: ['components.0.ingredients.1.quantity'],
    }));
    const edit = mocks.editRecipe.mock.calls[0][1];
    expect(edit.components[0].ingredients[0]).toEqual(recipe.extracted.components[0].ingredients[0]);
    expect(edit).not.toHaveProperty('is_public');
    expect(mocks.close).toHaveBeenCalledOnce();
    await act(async () => tree.unmount());
  });
  it('keeps entered corrections after a failed save and permits retry', async () => {
    mocks.editRecipe.mockRejectedValueOnce(new Error('Offline'));
    const tree = await render();
    await act(async () => { host(tree, 'TextInput')[0].props.onChangeText('3'); });
    await act(async () => { host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress(); });
    expect(mocks.alert).toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(host(tree, 'TextInput')[0].props.value).toBe('3');
    await act(async () => { host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress(); });
    expect(mocks.close).toHaveBeenCalledOnce();
    await act(async () => tree.unmount());
  });
  it('resolves only an explicitly checked source warning without verifying all fields', async () => {
    const sourceRecipe = { ...recipe, extraction_evidence: { version: 2, assessment: { issues: [
      { code: 'source_warning', id: 'source-warning:abc', path: null, message: 'Oven temperature was unclear.' },
    ] } } };
    const tree = await render(sourceRecipe);
    expect(host(tree, 'TextInput')).toHaveLength(0);
    await act(async () => { host(tree, 'TouchableOpacity', props => props.accessibilityRole === 'checkbox')[0].props.onPress(); });
    await act(async () => { host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress(); });
    expect(mocks.editRecipe).toHaveBeenCalledWith('r1', expect.objectContaining({
      review_content_revision: 5, verified_paths: [], resolved_issue_ids: ['source-warning:abc'],
    }));
    await act(async () => tree.unmount());
  });
  it('does not refill cleared account caches after the review is unmounted', async () => {
    let finish!: (value: Recipe) => void;
    mocks.editRecipe.mockReturnValueOnce(new Promise<Recipe>(resolve => { finish = resolve; }));
    const tree = await render();
    await act(async () => { host(tree, 'TextInput')[0].props.onChangeText('3'); });
    await act(async () => { host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress(); });
    await act(async () => tree.unmount());
    await act(async () => finish(recipe));
    expect(mocks.setQueryData).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it('prevents duplicate saves while a correction is in flight', async () => {
    let finish!: (value: Recipe) => void;
    mocks.editRecipe.mockReturnValueOnce(new Promise<Recipe>(resolve => { finish = resolve; }));
    const tree = await render();
    await act(async () => { host(tree, 'TextInput')[0].props.onChangeText('3'); });
    await act(async () => {
      const press = host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress;
      press(); press();
    });
    expect(mocks.editRecipe).toHaveBeenCalledOnce();
    await act(async () => finish(recipe));
    await act(async () => tree.unmount());
  });
});


it('shows the suggested amount and reason, and keeps estimate provenance when accepted', async () => {
  const estimated = structuredClone(recipe);
  const estimate = { quantity: '3', unit: 'cups', reason: 'For the stated rice amount.' };
  estimated.extracted.components[0].ingredients[1].quantityEstimate = estimate;
  estimated.extraction_evidence = { assessment: { issues: [{ code: 'estimated_quantity', path: 'components.0.ingredients.1.quantity', message: 'AI estimated this amount.' }] } };
  const tree = await render(estimated);
  expect(JSON.stringify(tree.toJSON())).toContain('3 cups · AI estimate');
  expect(JSON.stringify(tree.toJSON())).toContain(estimate.reason);
  expect(host(tree, 'TextInput')[0].props.value).toBe('');
  await act(async () => host(tree, 'TouchableOpacity', props => props.accessibilityLabel === 'Keep AI estimate for Water')[0].props.onPress());
  await act(async () => host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress());
  const edit = mocks.editRecipe.mock.calls[0][1];
  expect(edit.components[0].ingredients[1]).toMatchObject({ quantity: null, quantityEstimate: estimate });
  await act(async () => tree.unmount());
});

it.each(['tbsp', ''])('requires explicit source unit %j before replacing an AI amount', async (unit) => {
  const estimated = structuredClone(recipe);
  const path = 'components.0.ingredients.1.quantity';
  estimated.extracted.components[0].ingredients[1] = {
    name: 'Salt', quantity: null, unit: null,
    quantityEstimate: { quantity: '1', unit: 'tsp', reason: 'For this batch.' },
  };
  const tree = await render(estimated);
  await act(async () => host(tree, 'TextInput', props => props.accessibilityLabel === 'Amount for Salt')[0].props.onChangeText('1'));
  const unitInput = host(tree, 'TextInput', props => props.accessibilityLabel === 'Unit for Salt')[0];
  expect(unitInput.props.value).toBe('');
  expect(unitInput.props.placeholder).toBe('e.g. tsp');
  await act(async () => host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress());
  expect(mocks.editRecipe).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith('Couldn’t save changes', 'Confirm the unit for Salt, or choose No unit.');
  if (unit) {
    await act(async () => unitInput.props.onChangeText(unit));
  } else {
    await act(async () => host(tree, 'TouchableOpacity', props => props.accessibilityLabel === 'No unit for Salt')[0].props.onPress());
  }
  await act(async () => host(tree, 'Button', props => props.title === 'Save changes')[0].props.onPress());
  const edit = mocks.editRecipe.mock.calls[0][1];
  expect(edit.components[0].ingredients[1]).toMatchObject({ quantity: '1', unit: unit || null, quantityEstimate: null });
  expect(edit.verified_paths).toEqual(unit ? [path, 'components.0.ingredients.1.unit'] : [path]);
  await act(async () => tree.unmount());
});

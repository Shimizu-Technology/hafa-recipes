import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  editRecipe: vi.fn(), close: vi.fn(), alert: vi.fn(), setQueryData: vi.fn(), invalidateQueries: vi.fn(),
}));
vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) => ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Alert: { alert: mocks.alert }, KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Modal: host('Modal'), Platform: { OS: 'ios' }, ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles }, TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'), View: host('View'),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: mocks.setQueryData, invalidateQueries: mocks.invalidateQueries }) }));
vi.mock('@/lib/api', () => ({ api: { editRecipe: mocks.editRecipe } }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  return {
    Text: (props: Record<string, unknown>) => ReactModule.createElement('Text', props, props.children as React.ReactNode),
    Button: (props: Record<string, unknown>) => ReactModule.createElement('Button', props),
    useColors: () => ({ tint: '#37745B', text: '#222', textSecondary: '#555', background: '#fff', backgroundSecondary: '#eee', border: '#ccc' }),
  };
});
import { RecipeDetailsReview } from '@/components/RecipeDetailsReview';

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

beforeEach(() => { vi.clearAllMocks(); mocks.editRecipe.mockResolvedValue({ ...recipe, review_state: 'ready' }); });

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

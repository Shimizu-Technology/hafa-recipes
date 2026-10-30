vi.mock('@/hooks/useOfflineLease', () => ({ useRecipeOwnerGeneration: () => JSON.stringify(['subject', mocks.ownerId, 'fixture', 0]) }));
vi.mock('@/hooks/useRecipeQuery', async () => {
  const query = await import('@tanstack/react-query');
  return { useRecipeMutation: query.useMutation, useRecipeQueryClient: query.useQueryClient };
});
vi.mock('@/lib/privateRecipeDrafts', () => ({ preserveDraftImage: vi.fn(async (_owner: string, uri: string) => uri), privateRecipeDrafts: { assert: vi.fn(), lease: (owner: string) => ({ owner }), write: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } }));
vi.mock('@/hooks/usePrivateRecipeDraft', () => ({ usePrivateRecipeDraft: () => ({ available: null, ready: true, error: null, flush: vi.fn(), finish: vi.fn(async () => undefined), resume: vi.fn(), discard: vi.fn() }) }));
vi.mock('@/hooks/useImportInbox', () => ({ useImportInbox: () => ({ ownerId: mocks.ownerId, entries: [] }) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  ownerId: 'owner-a',
  alert: vi.fn(),
  isPending: false,
  back: vi.fn(),
  createManualRecipe: vi.fn(async (payload: { is_public: boolean }) => ({
    id: 'recipe-1',
    is_public: payload.is_public,
  })),
  replace: vi.fn(),
  requestPublishing: vi.fn(async () => true),
  params: {
    initialData: JSON.stringify({
      title: 'Red Rice',
      ingredients: [{ name: 'rice', quantity: '2', unit: 'cups' }],
      steps: ['Cook the rice.'],
      tags: ['Dinner'],
    }),
    isPublic: 'false',
    captureSource: 'text',
    initialImageUri: undefined as string | undefined,
  },
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: mocks.alert },
    Image: host('Image'),
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Platform: { OS: 'ios' },
    ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});
vi.mock('expo-router', async () => {
  const ReactModule = await import('react');
  const Screen = ({ options }: {
    options: { headerRight?: () => React.ReactNode };
  }) => ReactModule.createElement('StackScreen', null, options.headerRight?.());
  const Stack = () => null;
  Stack.Screen = Screen;
  return {
    Stack,
    useLocalSearchParams: () => mocks.params,
    useRouter: () => ({ back: mocks.back, replace: mocks.replace }),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: {
    mutationFn: (variables: { requestedPublic: boolean; originalOwner: string | null }) => Promise<unknown>;
    onSuccess: (result: unknown) => void;
    onError: (error: Error) => void;
  }) => ({
    isPending: mocks.isPending,
    mutate: (variables: { requestedPublic: boolean; originalOwner: string | null }) => {
      void options.mutationFn(variables).then(options.onSuccess).catch(options.onError);
    },
  }),
  useQueryClient: () => ({}),
}));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Text: host('ThemedText'),
    View: host('ThemedView'),
    useColors: () => ({
      background: '#fff',
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      error: '#b42318',
      text: '#111',
      textMuted: '#666',
      textSecondary: '#555',
      tint: '#155c52',
    }),
  };
});
vi.mock('@/components/RecipeVisibilitySelector', async () => {
  const ReactModule = await import('react');
  return {
    RecipeVisibilitySelector: ({ value, onChange, disabled }: {
      value: 'private' | 'public';
      onChange: (value: 'private' | 'public') => void;
      disabled?: boolean;
    }) => ReactModule.createElement(
      'NativeView',
      null,
      ReactModule.createElement('TouchableOpacity', {
        accessibilityLabel: 'Private',
        accessibilityState: { checked: value === 'private', disabled },
        onPress: () => onChange('private'),
      }),
      ReactModule.createElement('TouchableOpacity', {
        accessibilityLabel: 'Public in Discover',
        accessibilityState: { checked: value === 'public', disabled },
        onPress: () => onChange('public'),
      }),
    ),
  };
});
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { sm: 4, md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({
    requestPublishing: mocks.requestPublishing,
    didChoosePrivate: () => true,
    isCheckingDisclosure: false,
  }),
}));
vi.mock('@/hooks/useRecipes', () => ({
  invalidateCreatedRecipeQueries: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  api: {
    createManualRecipe: mocks.createManualRecipe,
    estimateNutrition: vi.fn(),
    suggestTags: vi.fn(),
  },
}));
vi.mock('@/lib/recipePublishing', () => ({
  formatPublishDisclosure: vi.fn(() => 'Preview'),
}));

vi.mock('@/components/NutritionPanel', () => ({ NutritionPanel: () => null }));
import AddRecipeScreen from '../app/add-recipe';

/** Render a valid imported recipe so the test can focus on visibility behavior. */
async function renderRecipe(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<AddRecipeScreen />);
  });
  return renderer!;
}

/** Find the explicit visibility option exposed by the shared selector. */
function visibilityOption(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
    .find((node) => node.props.accessibilityLabel === label)!;
}

/** Find the header save action by its current public/private label. */
function headerAction(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
    .find((node) => node.findAllByType('ThemedText' as unknown as React.ComponentType)
      .some((text) => text.props.children === label))!;
}

describe('AddRecipeScreen visibility', () => {
  beforeEach(() => {
    mocks.ownerId = 'owner-a';
    mocks.params.initialData = JSON.stringify({
      title: 'Red Rice',
      ingredients: [{ name: 'rice', quantity: '2', unit: 'cups' }],
      steps: ['Cook the rice.'],
      tags: ['Dinner'],
    });
    mocks.params.isPublic = 'false';
    mocks.params.captureSource = 'text';
    mocks.params.initialImageUri = undefined;
    mocks.isPending = false;
    mocks.alert.mockClear();
    mocks.back.mockClear();
    mocks.createManualRecipe.mockClear();
    mocks.replace.mockClear();
    mocks.requestPublishing.mockReset();
    mocks.requestPublishing.mockResolvedValue(true);
  });

  it('publishes only after the public choice is accepted', async () => {
    const renderer = await renderRecipe();

    await act(async () => visibilityOption(renderer, 'Public in Discover').props.onPress());
    await act(async () => headerAction(renderer, 'Publish').props.onPress());

    expect(mocks.requestPublishing).toHaveBeenCalledTimes(1);
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ is_public: true }),
      null, expect.any(Function),
    );
  });

  it('keeps the save private when the public choice is declined', async () => {
    mocks.requestPublishing.mockResolvedValueOnce(false);
    const renderer = await renderRecipe();

    await act(async () => visibilityOption(renderer, 'Public in Discover').props.onPress());
    expect(mocks.requestPublishing).not.toHaveBeenCalled();
    await act(async () => headerAction(renderer, 'Publish').props.onPress());
    expect(visibilityOption(renderer, 'Private').props.accessibilityState.checked).toBe(true);

    expect(mocks.requestPublishing).toHaveBeenCalledTimes(1);
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ is_public: false }),
      null, expect.any(Function),
    );
  });

  it('saves a recovered image-only recipe as an editable private draft', async () => {
    mocks.params.initialData = undefined as unknown as string;
    mocks.params.captureSource = 'photo';
    mocks.params.initialImageUri = 'file:///recipe-card.jpg';
    const renderer = await renderRecipe();
    const titleInput = renderer.root.findAllByType(
      'TextInput' as unknown as React.ComponentType,
    ).find((node) => node.props.placeholder === 'Recipe name')!;

    await act(async () => titleInput.props.onChangeText('Family recipe card'));
    await act(async () => headerAction(renderer, 'Save draft').props.onPress());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createManualRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Family recipe card',
        ingredients: [],
        steps: [],
        is_public: false,
        source_type: 'photo',
      }),
      'file:///recipe-card.jpg', expect.any(Function),
    );
  });
  it('preserves an imported AI estimate separately when saving from the fallback editor', async () => {
    const estimate = { quantity: '2', unit: 'cups', reason: 'For this batch.' };
    mocks.params.initialData = JSON.stringify({ title: 'Rice', ingredients: [{ name: 'rice', quantity: null, unit: null, quantityEstimate: estimate }], steps: ['Cook.'] });
    const renderer = await renderRecipe();
    await act(async () => headerAction(renderer, 'Save private').props.onPress());
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(expect.objectContaining({ ingredients: [expect.objectContaining({ quantity: null, quantityEstimate: estimate })] }), null, expect.any(Function));
  });

  it('discards contextual estimates when the user changes the serving count in the fallback editor', async () => {
    const estimate = { quantity: '2', unit: 'cups', reason: 'For this batch.' };
    mocks.params.initialData = JSON.stringify({ title: 'Rice', servings: 4, ingredients: [{ name: 'rice', quantity: null, unit: null, quantityEstimate: estimate }], steps: ['Cook.'] });
    const renderer = await renderRecipe();
    const input = renderer.root.findAllByType('TextInput' as unknown as React.ComponentType).find(node => node.props.value === '4')!;
    await act(async () => input.props.onChangeText('6'));
    await act(async () => headerAction(renderer, 'Save private').props.onPress());
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(expect.objectContaining({ servings: 6, ingredients: [expect.objectContaining({ quantity: null, quantityEstimate: null })] }), null, expect.any(Function));
  });

  it('does not copy an AI unit into source fields when renaming an ingredient', async () => {
    const estimate = { quantity: '2', unit: 'cups', reason: 'For this batch.' };
    mocks.params.initialData = JSON.stringify({ title: 'Rice', ingredients: [{ name: 'rice', quantity: null, unit: null, quantityEstimate: estimate }], steps: ['Cook.'] });
    const renderer = await renderRecipe();
    const input = renderer.root.findAllByType('TextInput' as unknown as React.ComponentType).find(node => node.props.placeholder === 'Ingredient name')!;
    await act(async () => input.props.onChangeText('brown rice'));
    await act(async () => headerAction(renderer, 'Save private').props.onPress());
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(expect.objectContaining({ ingredients: [expect.objectContaining({ name: 'brown rice', quantity: null, unit: null, quantityEstimate: null })] }), null, expect.any(Function));
  });

  it('defaults new entries to public and saves without a tags or nutrition prompt', async () => {
    mocks.params.isPublic = undefined as unknown as string;
    const renderer = await renderRecipe();
    expect(visibilityOption(renderer, 'Public in Discover').props.accessibilityState.checked).toBe(true);
    await act(async () => headerAction(renderer, 'Publish').props.onPress());
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(expect.objectContaining({ is_public: true }), null, expect.any(Function));
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith('/recipe/recipe-1');
  });

});

describe('AddRecipeScreen accessibility', () => {
  beforeEach(() => {
    mocks.ownerId = 'owner-a';
    mocks.params.initialData = JSON.stringify({
      title: 'Red Rice',
      ingredients: [
        { name: 'rice', quantity: '2', unit: 'cups' },
        { name: 'achiote', quantity: '1', unit: 'tbsp' },
      ],
      steps: ['Cook the rice.'],
    });
    mocks.params.isPublic = 'false';
    mocks.params.captureSource = 'text';
    mocks.params.initialImageUri = undefined;
    mocks.isPending = false;
  });

  function button(renderer: ReactTestRenderer, label: string) {
    return renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
      .find((node) => node.props.accessibilityLabel === label);
  }

  it('labels the icon-only photo, ingredient, unit, and step controls', async () => {
    const renderer = await renderRecipe();

    for (const label of [
      'Add recipe photo',
      'Remove ingredient 1',
      'Remove ingredient 2',
      'Choose unit for ingredient 1',
      'Choose unit for ingredient 2',
      'Remove step 1',
    ]) {
      expect(button(renderer, label)?.props.accessibilityRole, label).toBe('button');
    }
    // The only step cannot be removed, and assistive tech is told so.
    expect(button(renderer, 'Remove step 1')!.props.disabled).toBe(true);
    expect(button(renderer, 'Remove step 1')!.props.accessibilityState).toEqual({ disabled: true });

    const save = headerAction(renderer, 'Save private');
    expect(save.props.accessibilityRole).toBe('button');
    expect(save.props.accessibilityState).toEqual({ disabled: false, busy: false });
  });

  it('enables step removal once there is more than one step', async () => {
    mocks.params.initialData = JSON.stringify({ title: 'Rice', ingredients: [], steps: ['Rinse.', 'Cook.'] });
    const renderer = await renderRecipe();

    expect(button(renderer, 'Remove step 1')!.props.accessibilityState).toEqual({ disabled: false });
    expect(button(renderer, 'Remove step 2')!.props.accessibilityState).toEqual({ disabled: false });
  });

  it('labels the photo control as a change once a photo is attached', async () => {
    mocks.params.initialImageUri = 'file:///recipe-card.jpg';
    const renderer = await renderRecipe();

    expect(button(renderer, 'Change recipe photo')?.props.accessibilityRole).toBe('button');
    expect(button(renderer, 'Add recipe photo')).toBeUndefined();
  });

  it('announces the header save action as busy while saving', async () => {
    mocks.isPending = true;
    const renderer = await renderRecipe();

    const save = button(renderer, 'Saving recipe')!;
    expect(save.props.accessibilityRole).toBe('button');
    expect(save.props.disabled).toBe(true);
    expect(save.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});

it('hides imported manual-edit route payloads when their original owner changes', async () => {
 let renderer!: ReactTestRenderer;
 try {
  await act(async()=>{renderer=create(<AddRecipeScreen/>)});
  expect(JSON.stringify(renderer.toJSON())).toContain('Red Rice');
  mocks.ownerId='owner-b';await act(async()=>renderer.update(<AddRecipeScreen/>));
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Red Rice');
 }finally{await act(async()=>renderer.unmount());}
});

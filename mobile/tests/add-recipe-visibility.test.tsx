import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
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
    mutationFn: () => Promise<unknown>;
    onSuccess: (result: unknown) => void;
    onError: (error: Error) => void;
  }) => ({
    isPending: false,
    mutate: () => {
      void options.mutationFn().then(options.onSuccess).catch(options.onError);
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

/** Choose Skip in the optional AI enrichment prompt to continue the save. */
async function skipOptionalAiPrompt() {
  const prompt = mocks.alert.mock.calls.find(([title]) => title === 'Add AI-Powered Info?');
  const skip = prompt?.[2].find((action: { text: string }) => action.text === 'Skip');
  await act(async () => {
    skip?.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AddRecipeScreen visibility', () => {
  beforeEach(() => {
    mocks.params.initialData = JSON.stringify({
      title: 'Red Rice',
      ingredients: [{ name: 'rice', quantity: '2', unit: 'cups' }],
      steps: ['Cook the rice.'],
      tags: ['Dinner'],
    });
    mocks.params.isPublic = 'false';
    mocks.params.captureSource = 'text';
    mocks.params.initialImageUri = undefined;
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
    await skipOptionalAiPrompt();

    expect(mocks.requestPublishing).toHaveBeenCalledTimes(2);
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ is_public: true }),
      null,
    );
  });

  it('keeps the save private when the public choice is declined', async () => {
    mocks.requestPublishing.mockResolvedValueOnce(false);
    const renderer = await renderRecipe();

    await act(async () => visibilityOption(renderer, 'Public in Discover').props.onPress());
    expect(visibilityOption(renderer, 'Private').props.accessibilityState.checked).toBe(true);
    await act(async () => headerAction(renderer, 'Save private').props.onPress());
    await skipOptionalAiPrompt();

    expect(mocks.requestPublishing).toHaveBeenCalledTimes(1);
    expect(mocks.createManualRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ is_public: false }),
      null,
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
      'file:///recipe-card.jpg',
    );
  });
});

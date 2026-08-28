import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  requestPublishing: vi.fn(async () => true),
  save: vi.fn(async (params: { is_public: boolean }) => ({
    id: 'recipe-1',
    is_public: params.is_public,
  })),
  params: {
    recipe: '',
    location: 'Guam',
    isPublic: 'false',
    sourceType: 'photo' as 'photo' | 'text',
  },
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);

  return {
    Alert: { alert: mocks.alert },
    ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});

vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return {
    Stack,
    useLocalSearchParams: () => mocks.params,
    useRouter: () => ({ back: mocks.back, replace: mocks.replace }),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }));
vi.mock('@/components/Themed', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    Button: ({ title, ...props }: { title: string }) =>
      ReactModule.createElement('Button', props, title),
    Text: host('ThemedText'),
    View: host('ThemedView'),
    useColors: () => ({
      background: '#fff',
      backgroundElevated: '#fffdf8',
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      accent: '#b94722',
      accentSoft: '#fbe8de',
      text: '#111',
      textMuted: '#666',
      textSecondary: '#555',
      tint: '#e85d2a',
      warning: '#f4b942',
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
  fontFamily: { displaySemibold: 'Fraunces' },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
}));
vi.mock('@/hooks/useRecipes', () => ({
  useSaveCapturedRecipe: () => ({ mutateAsync: mocks.save }),
}));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({ requestPublishing: mocks.requestPublishing, isCheckingDisclosure: false }),
}));
vi.mock('@/lib/ocrReview', () => ({
  getOcrPublishDisclosure: () => ({
    title: 'Red Rice',
    ingredientCount: 0,
    instructionCount: 0,
    hasPhoto: false,
    hasSourceLink: false,
    contributorName: 'your contributor name',
  }),
  hasOcrNutrition: () => true,
}));
vi.mock('@/lib/recipePublishing', () => ({ formatPublishDisclosure: vi.fn(() => 'Preview') }));

import OCRReviewScreen from '../app/ocr-review';

const warning = 'The amount for chicken was unclear. Check it before saving.';
const baseRecipe = {
  title: 'Red Rice',
  components: [],
  tags: ['Dinner'],
  nutrition: { perServing: { calories: 220 } },
};

/** Render the screen after its route payload has populated local state. */
async function renderRecipe(confidence: Record<string, unknown>): Promise<ReactTestRenderer> {
  mocks.params.recipe = JSON.stringify({ ...baseRecipe, ...confidence });
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(OCRReviewScreen));
  });
  return renderer!;
}

/** Find only host text nodes containing the conditional confidence warning. */
function confidenceWarnings(renderer: ReactTestRenderer) {
  const themedTextType = 'ThemedText' as unknown as React.ComponentType;
  return renderer.root.findAllByType(themedTextType).filter(
    (node) => node.props.children === warning,
  );
}

describe('OCRReviewScreen confidence notice', () => {
  beforeEach(() => {
    mocks.alert.mockClear();
    mocks.back.mockClear();
    mocks.replace.mockClear();
    mocks.requestPublishing.mockReset();
    mocks.requestPublishing.mockResolvedValue(true);
    mocks.save.mockClear();
    mocks.params.isPublic = 'false';
    mocks.params.sourceType = 'photo';
  });

  it('shows the model warning when both confidence fields are present', async () => {
    const renderer = await renderRecipe({ lowConfidence: true, confidenceWarning: warning });

    expect(confidenceWarnings(renderer)).toHaveLength(1);
  });

  it('explains pasted-text handling for text captures', async () => {
    mocks.params.sourceType = 'text';
    const renderer = await renderRecipe({ lowConfidence: false });
    const themedTextType = 'ThemedText' as unknown as React.ComponentType;
    const copy = renderer.root.findAllByType(themedTextType).flatMap(
      (node) => typeof node.props.children === 'string' ? [node.props.children] : [],
    );

    expect(copy).toContain(
      'AI can misunderstand copied formatting or missing context. Håfa Recipes does not store the original pasted text with your saved recipe.',
    );
  });

  it.each([
    ['the low-confidence flag is absent', { confidenceWarning: warning }],
    ['the warning is absent', { lowConfidence: true }],
  ])('hides the confidence notice when %s', async (_label, confidence) => {
    const renderer = await renderRecipe(confidence);

    expect(confidenceWarnings(renderer)).toHaveLength(0);
  });
});

describe('OCRReviewScreen visibility', () => {
  beforeEach(() => {
    mocks.alert.mockClear();
    mocks.back.mockClear();
    mocks.replace.mockClear();
    mocks.requestPublishing.mockReset();
    mocks.requestPublishing.mockResolvedValue(true);
    mocks.save.mockClear();
    mocks.params.isPublic = 'false';
    mocks.params.sourceType = 'text';
  });

  it('saves the default choice privately and says exactly where it was saved', async () => {
    const renderer = await renderRecipe({ lowConfidence: false });
    const submit = renderer.root.findAllByType('Button' as unknown as React.ComponentType)
      .find((node) => node.props.children === 'Save Private Recipe');

    await act(async () => submit!.props.onPress());

    expect(mocks.requestPublishing).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      source_type: 'text',
      is_public: false,
    }));
    expect(mocks.alert).toHaveBeenCalledWith(
      'Saved privately',
      'Only you can open this recipe. You can publish it later from the recipe page.',
      expect.any(Array),
    );
  });

  it('requires publishing confirmation and sends an explicit public save', async () => {
    const renderer = await renderRecipe({ lowConfidence: false });
    const publicOption = renderer.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    ).find((node) => node.props.accessibilityLabel === 'Public in Discover');

    await act(async () => publicOption!.props.onPress());

    expect(publicOption!.props.accessibilityState.checked).toBe(true);
    const submit = renderer.root.findAllByType('Button' as unknown as React.ComponentType)
      .find((node) => node.props.children === 'Publish Recipe');
    await act(async () => submit!.props.onPress());

    expect(mocks.requestPublishing).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ is_public: true }));
    expect(mocks.alert).toHaveBeenCalledWith(
      'Published to Discover',
      'Anyone can now find and open this recipe in Discover.',
      expect.any(Array),
    );
  });

  it('keeps the recipe private when publishing confirmation is declined', async () => {
    mocks.requestPublishing.mockResolvedValueOnce(false);
    const renderer = await renderRecipe({ lowConfidence: false });
    const publicOption = renderer.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    ).find((node) => node.props.accessibilityLabel === 'Public in Discover');

    await act(async () => publicOption!.props.onPress());

    expect(publicOption!.props.accessibilityState.checked).toBe(false);
    expect(renderer.root.findAllByType('Button' as unknown as React.ComponentType)
      .some((node) => node.props.children === 'Save Private Recipe')).toBe(true);
  });

  it('hydrates a public route choice before the review is saved', async () => {
    mocks.params.isPublic = 'true';
    const renderer = await renderRecipe({ lowConfidence: false });
    const publicOption = renderer.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    ).find((node) => node.props.accessibilityLabel === 'Public in Discover');

    expect(publicOption!.props.accessibilityState.checked).toBe(true);
    expect(renderer.root.findAllByType('Button' as unknown as React.ComponentType)
      .some((node) => node.props.children === 'Publish Recipe')).toBe(true);
  });
});

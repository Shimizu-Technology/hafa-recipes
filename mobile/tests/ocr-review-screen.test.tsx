import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  params: {
    recipe: '',
    location: 'Guam',
    isPublic: 'false',
  },
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);

  return {
    Alert: { alert: vi.fn() },
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
    useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
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
      backgroundSecondary: '#f7f2e8',
      border: '#ddd',
      text: '#111',
      textMuted: '#666',
      textSecondary: '#555',
      tint: '#e85d2a',
      warning: '#f4b942',
    }),
  };
});
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 24 },
  fontWeight: { medium: '500', semibold: '600', bold: '700' },
  radius: { md: 8, lg: 12 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
}));
vi.mock('@/hooks/useRecipes', () => ({
  useSaveOcrRecipe: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({ requestPublishing: vi.fn(), isCheckingDisclosure: false }),
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
  it('shows the model warning when both confidence fields are present', async () => {
    const renderer = await renderRecipe({ lowConfidence: true, confidenceWarning: warning });

    expect(confidenceWarnings(renderer)).toHaveLength(1);
  });

  it.each([
    ['the low-confidence flag is absent', { confidenceWarning: warning }],
    ['the warning is absent', { lowConfidence: true }],
  ])('hides the confidence notice when %s', async (_label, confidence) => {
    const renderer = await renderRecipe(confidence);

    expect(confidenceWarnings(renderer)).toHaveLength(0);
  });
});

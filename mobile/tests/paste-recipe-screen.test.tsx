import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  clipboard: vi.fn(async () => 'Red Rice\r\n2 cups rice\r\nCook the rice.'),
  extract: vi.fn(async () => ({
    success: true,
    recipe: { title: 'Red Rice', components: [] },
  })),
  alert: vi.fn(),
  push: vi.fn(),
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: mocks.alert },
    Keyboard: { dismiss: vi.fn() },
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Platform: { OS: 'ios' },
    ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    TextInput: host('TextInput'),
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});
vi.mock('expo-clipboard', () => ({ getStringAsync: mocks.clipboard }));
vi.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  return {
    Stack,
    useLocalSearchParams: () => ({ location: 'Guam', isPublic: 'false' }),
    useRouter: () => ({ push: mocks.push }),
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
    Chip: ({ label, ...props }: { label: string }) =>
      ReactModule.createElement('Chip', props, label),
    Text: host('ThemedText'),
    useColors: () => ({
      accent: '#168A80',
      accentSoft: '#DDF5F1',
      background: '#FFF7EC',
      backgroundElevated: '#FFFCF7',
      backgroundSecondary: '#F8EFE3',
      border: '#E8D8C8',
      error: '#C43C2E',
      text: '#17120E',
      textMuted: '#9A8978',
      textSecondary: '#6D5D50',
      tint: '#E65F2E',
    }),
  };
});
vi.mock('@/constants/Colors', () => ({
  fontFamily: { displaySemibold: 'Fraunces', medium: 'DMSans', regular: 'DMSans' },
  fontSize: { xs: 11, sm: 13, md: 15, xl: 20 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { md: 14, lg: 20, xl: 28, full: 9999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('@/hooks/useRecipes', () => ({
  useLocations: () => ({ data: { locations: [{ code: 'GU', name: 'Guam' }] } }),
}));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({ requestPublishing: vi.fn(), isCheckingDisclosure: false }),
}));
vi.mock('@/lib/api', () => ({
  api: { extractRecipeFromText: mocks.extract },
}));
vi.mock('@/lib/textCapture', () => ({
  MAX_PASTED_RECIPE_CHARS: 50_000,
  canExtractPastedRecipe: (value: string) => value.trim().length > 0 && value.length <= 50_000,
  normalizePastedRecipeText: (value: string) => value.replace(/\r\n?/g, '\n').trim(),
}));

import PasteRecipeScreen from '../app/paste-recipe';

describe('PasteRecipeScreen', () => {
  beforeEach(() => {
    mocks.alert.mockClear();
    mocks.extract.mockClear();
    mocks.push.mockClear();
  });

  it('pastes normalized text, extracts it, and opens text-aware review', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PasteRecipeScreen));
    });

    const pasteButton = renderer!.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    ).find((node) => node.props.accessibilityLabel === 'Paste recipe text from clipboard');
    await act(async () => {
      await pasteButton!.props.onPress();
    });

    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    expect(input.props.value).toBe('Red Rice\n2 cups rice\nCook the rice.');

    const submit = renderer!.root.findByType('Button' as unknown as React.ComponentType);
    expect(submit.props.disabled).toBe(false);
    await act(async () => {
      await submit.props.onPress();
    });

    expect(mocks.extract).toHaveBeenCalledWith(
      'Red Rice\n2 cups rice\nCook the rice.',
      'Guam',
    );
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: '/ocr-review',
      params: {
        recipe: JSON.stringify({ title: 'Red Rice', components: [] }),
        location: 'Guam',
        isPublic: 'false',
        sourceType: 'text',
      },
    });
  });

  it('shows the extraction error and stays on the paste screen', async () => {
    mocks.extract.mockResolvedValueOnce({
      success: false,
      error: 'No cooking steps were found.',
    } as any);
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PasteRecipeScreen));
    });

    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    await act(async () => input.props.onChangeText('1 cup rice\nCook it.'));
    const submit = renderer!.root.findByType('Button' as unknown as React.ComponentType);
    await act(async () => submit.props.onPress());

    expect(mocks.alert).toHaveBeenCalledWith(
      'Could Not Build a Recipe',
      'No cooking steps were found.',
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('explains oversized server rejections and does not navigate', async () => {
    mocks.extract.mockRejectedValueOnce({ response: { status: 413 } });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PasteRecipeScreen));
    });

    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    await act(async () => input.props.onChangeText('1 cup rice\nCook it.'));
    const submit = renderer!.root.findByType('Button' as unknown as React.ComponentType);
    await act(async () => submit.props.onPress());

    expect(mocks.alert).toHaveBeenCalledWith(
      'Import Failed',
      'That text is too large. Shorten it to the recipe itself and try again.',
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('disables draft creation when normalized text exceeds the limit', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PasteRecipeScreen));
    });

    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    await act(async () => input.props.onChangeText(`  ${'x'.repeat(50_001)}  `));
    const submit = renderer!.root.findByType('Button' as unknown as React.ComponentType);

    expect(submit.props.disabled).toBe(true);
    expect(mocks.extract).not.toHaveBeenCalled();
  });
});

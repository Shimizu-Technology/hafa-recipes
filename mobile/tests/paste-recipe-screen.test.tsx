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
  consume: vi.fn(() => null as null | { kind: 'text'; text: string }),
  params: { location: 'Guam', isPublic: 'false', captureToken: undefined as string | undefined },
  replace: vi.fn(),
  save: vi.fn(async () => ({ id: 'recipe-1' })),
  requestPublishing: vi.fn(async () => true),
  setParams: vi.fn(),
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));

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
    useLocalSearchParams: () => mocks.params,
    useRouter: () => ({ replace: mocks.replace, setParams: mocks.setParams }),
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
      accent: '#B94722',
      accentSoft: '#FBE8DE',
      background: '#FFF7EC',
      backgroundElevated: '#FFFCF7',
      backgroundSecondary: '#F8EFE3',
      border: '#E8D8C8',
      error: '#C43C2E',
      text: '#17120E',
      textMuted: '#9A8978',
      textSecondary: '#6D5D50',
      tint: '#155C52',
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
  useSaveCapturedRecipe: () => ({ mutateAsync: mocks.save }),
  useLocations: () => ({ data: { locations: [{ code: 'GU', name: 'Guam' }] } }),
}));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({ requestPublishing: mocks.requestPublishing, isCheckingDisclosure: false }),
}));
vi.mock('@/lib/api', () => ({
  api: { extractRecipeFromText: mocks.extract },
}));
vi.mock('@/lib/textCapture', () => ({
  MAX_PASTED_RECIPE_CHARS: 50_000,
  canExtractPastedRecipe: (value: string) => value.trim().length > 0 && value.length <= 50_000,
  normalizePastedRecipeText: (value: string) => value.replace(/\r\n?/g, '\n').trim(),
}));
vi.mock('@/lib/shareCapture', () => ({ consumePendingShareCapture: mocks.consume }));

import PasteRecipeScreen from '../app/paste-recipe';

describe('PasteRecipeScreen', () => {
  beforeEach(() => {
    mocks.save.mockReset();
    mocks.save.mockResolvedValue({ id: 'recipe-1' });
    mocks.requestPublishing.mockReset();
    mocks.requestPublishing.mockResolvedValue(true);
    mocks.alert.mockClear();
    mocks.extract.mockClear();
    mocks.replace.mockClear();
    mocks.setParams.mockClear();
    mocks.consume.mockReset();
    mocks.consume.mockReturnValue(null);
    mocks.params.captureToken = undefined;
    mocks.params.isPublic = 'false';
  });

  it('automatically saves an explicitly public capture after disclosure', async () => {
    mocks.params.isPublic = 'true';
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PasteRecipeScreen));
    });

    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    await act(async () => input.props.onChangeText('Red Rice\n2 cups rice\nCook the rice.'));
    const submit = renderer!.root.findByType('Button' as unknown as React.ComponentType);
    await act(async () => submit.props.onPress());

    expect(mocks.requestPublishing).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ is_public: true, source_type: 'text' }));
    expect(mocks.replace).toHaveBeenCalledWith('/recipe/recipe-1');
  });

  it('prefills plain text consumed from a native share without persisting it', async () => {
    mocks.params.captureToken = 'share-token';
    mocks.consume.mockReturnValueOnce({ kind: 'text', text: '  Red Rice\r\nCook it.  ' });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PasteRecipeScreen));
    });

    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    expect(mocks.consume).toHaveBeenCalledWith('share-token');
    expect(mocks.setParams).toHaveBeenCalledWith({ captureToken: undefined });
    expect(input.props.value).toBe('Red Rice\nCook it.');
  });

  it('pastes normalized text and saves privately without a review step', async () => {
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
    expect(mocks.save).toHaveBeenCalledWith({
      extracted: { title: 'Red Rice', components: [] },
      capture_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source_type: 'text',
      is_public: false,
    });
    expect(mocks.requestPublishing).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith('/recipe/recipe-1');
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
    expect(mocks.replace).not.toHaveBeenCalled();
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
    expect(mocks.replace).not.toHaveBeenCalled();
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
  it('defaults a new capture to public and offers a private choice before import', async () => {
    mocks.params.isPublic = undefined as unknown as string;
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<PasteRecipeScreen />); });
    const options = renderer!.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType);
    const publicOption = options.find(node => node.props.accessibilityLabel === 'Public in Discover')!;
    const privateOption = options.find(node => node.props.accessibilityLabel === 'Private')!;
    expect(publicOption.props.accessibilityState.checked).toBe(true);
    await act(async () => privateOption.props.onPress());
    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    await act(async () => input.props.onChangeText('1 cup rice. Cook it.'));
    await act(async () => renderer!.root.findByType('Button' as unknown as React.ComponentType).props.onPress());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ is_public: false }));
    expect(mocks.requestPublishing).not.toHaveBeenCalled();
  });

  it('retains the extraction and privacy choice when saving fails', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Offline'));
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<PasteRecipeScreen />); });
    const input = renderer!.root.findByType('TextInput' as unknown as React.ComponentType);
    await act(async () => input.props.onChangeText('1 cup rice. Cook it.'));
    await act(async () => renderer!.root.findByType('Button' as unknown as React.ComponentType).props.onPress());
    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: '/ocr-review',
      params: {
        recipe: JSON.stringify({ title: 'Red Rice', components: [] }),
        location: 'Guam', isPublic: 'false', sourceType: 'text', saveFailed: 'true',
        captureId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', saveErrorKind: 'retry', saveErrorMessage: 'Offline',
      },
    });
  });

  it('does not extract or publish after a declined publishing disclosure', async () => {
    mocks.params.isPublic = 'true';
    mocks.requestPublishing.mockResolvedValueOnce(false);
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<PasteRecipeScreen />); });
    await act(async () => renderer!.root.findByType('TextInput' as unknown as React.ComponentType).props.onChangeText('1 cup rice. Cook it.'));
    await act(async () => renderer!.root.findByType('Button' as unknown as React.ComponentType).props.onPress());
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
      .find(node => node.props.accessibilityLabel === 'Private')!.props.accessibilityState.checked).toBe(true);
  });

  it('does not start a second extraction when the import action is tapped twice', async () => {
    let finish: ((value: { success: boolean; recipe: { title: string; components: never[] } }) => void) | undefined;
    mocks.extract.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<PasteRecipeScreen />); });
    await act(async () => renderer!.root.findByType('TextInput' as unknown as React.ComponentType).props.onChangeText('1 cup rice. Cook it.'));
    const submit = renderer!.root.findByType('Button' as unknown as React.ComponentType);
    await act(async () => {
      const first = submit.props.onPress();
      const second = submit.props.onPress();
      finish!({ success: true, recipe: { title: 'Rice', components: [] } });
      await Promise.all([first, second]);
    });
    expect(mocks.extract).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

});

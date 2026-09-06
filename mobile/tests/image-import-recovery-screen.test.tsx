import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  checkDuplicate: vi.fn(),
  extraction: {
    canRetryStart: false,
    canSaveDraft: false,
    confidenceWarning: null,
    connectionNotice: null,
    currentStep: '',
    elapsedTime: 0,
    error: null as string | null,
    isComplete: false,
    isExtracting: false,
    isFailed: false,
    isPreparing: false,
    isRetrying: false,
    jobKind: 'extract',
    lowConfidence: false,
    maxAttempts: 0,
    message: '',
    nextAttemptAt: null,
    progress: 0,
    recipeId: null as string | null,
    requestedIsPublic: false,
    reset: vi.fn(async () => undefined),
    restoreJob: vi.fn(),
    retryPendingStart: vi.fn(),
    saveSourceDraft: vi.fn(),
    sourceLocation: null as string | null,
    sourceNotes: '',
    sourceUrl: '',
    startExtraction: vi.fn(),
    startReExtraction: vi.fn(),
    terminalStatus: null,
  },
  extractMultiple: vi.fn(async () => ({
    success: false,
    error_code: 'IMAGE_UNSUPPORTED',
    error: 'These images do not show one readable recipe.',
  })),
  launchLibrary: vi.fn(async () => ({
    canceled: false,
    assets: [
      { uri: 'file:///recipe-front.jpg' },
      { uri: 'file:///recipe-back.jpg' },
    ],
  })),
  push: vi.fn(),
  requestPublishing: vi.fn(),
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const host = (name: string) => (props: Record<string, unknown>) =>
    ReactModule.createElement(name, props, props.children as React.ReactNode);
  return {
    AccessibilityInfo: { announceForAccessibility: vi.fn() },
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: mocks.alert },
    Image: host('Image'),
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Linking: { openURL: vi.fn() },
    Platform: { OS: 'ios' },
    ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    TouchableOpacity: host('TouchableOpacity'),
    View: host('NativeView'),
  };
});
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), setParams: vi.fn() }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('expo-image-picker', () => ({
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: mocks.launchLibrary,
  requestCameraPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
}));
vi.mock('expo-linear-gradient', async () => {
  const ReactModule = await import('react');
  return {
    LinearGradient: (props: Record<string, unknown>) =>
      ReactModule.createElement('LinearGradient', props, props.children as React.ReactNode),
  };
});
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
    Input: host('Input'),
    Text: host('ThemedText'),
    View: host('ThemedView'),
    useColors: () => ({
      accent: '#b94722', accentSoft: '#fbe8de', background: '#fff',
      backgroundSecondary: '#f7f2e8', border: '#ddd', error: '#b42318',
      success: '#177245', text: '#111', textMuted: '#666', textSecondary: '#555',
      tint: '#155c52', warning: '#b45309',
    }),
  };
});
vi.mock('@/components/ExtractionProgress', () => ({ default: () => null }));
vi.mock('@/components/SignInBanner', () => ({ SignInBanner: () => null }));
vi.mock('@/components/BrandMark', () => ({ BrandMark: () => null }));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { bold: 'DMSans', display: 'Fraunces', medium: 'DMSans', semibold: 'DMSans' },
  fontSize: { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 30, xxxl: 38 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { sm: 8, md: 14, lg: 20, xl: 28, xxl: 36, full: 9999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
}));
vi.mock('../../lib/guestPromptLayout', () => ({
  guestPromptBottomPadding: () => 0,
  useGuestPromptHeight: () => 0,
}));
vi.mock('@/hooks/useRecipes', () => ({
  useCheckDuplicate: () => ({ mutateAsync: mocks.checkDuplicate }),
  useExtractionJobs: () => ({ data: [] }),
  useLocations: () => ({ data: { locations: [
    { code: 'Guam', name: 'Guam' },
    { code: 'Hawaii', name: 'Hawaii' },
  ] } }),
}));
vi.mock('@/contexts/ExtractionContext', () => ({
  useAsyncExtraction: () => mocks.extraction,
}));
vi.mock('@/lib/api', () => ({
  api: {
    extractRecipeFromImage: vi.fn(),
    extractRecipeFromMultipleImages: mocks.extractMultiple,
  },
}));
vi.mock('@/lib/shareCapture', () => ({ consumePendingShareCapture: () => null }));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({
    requestPublishing: mocks.requestPublishing,
    isCheckingDisclosure: false,
  }),
}));
vi.mock('@/lib/imageImportClassification', async () => (
  await import('../lib/imageImportClassification')
));

import ExtractScreen from '../app/(tabs)/index';

/** Find a screen action by its visible themed-text label. */
function touchableWithText(renderer: ReactTestRenderer, text: string) {
  return renderer.root.findAllByType(
    'TouchableOpacity' as unknown as React.ComponentType,
  ).find(node => node.findAllByType(
    'ThemedText' as unknown as React.ComponentType,
  ).some(label => label.props.children === text));
}

describe('classified image recovery', () => {
  beforeEach(() => {
    mocks.alert.mockClear();
    mocks.checkDuplicate.mockReset();
    mocks.checkDuplicate.mockResolvedValue({ exists: false });
    mocks.extractMultiple.mockClear();
    mocks.launchLibrary.mockClear();
    mocks.push.mockClear();
    mocks.requestPublishing.mockReset();
    mocks.requestPublishing.mockResolvedValue(true);
    mocks.extraction.isComplete = false;
    mocks.extraction.isExtracting = false;
    mocks.extraction.isFailed = false;
    mocks.extraction.isPreparing = false;
    mocks.extraction.error = null;
    mocks.extraction.currentStep = '';
    mocks.extraction.jobKind = 'extract';
    mocks.extraction.recipeId = null;
    mocks.extraction.requestedIsPublic = false;
    mocks.extraction.sourceLocation = null;
    mocks.extraction.sourceNotes = '';
    mocks.extraction.sourceUrl = '';
    mocks.extraction.reset.mockClear();
    mocks.extraction.startExtraction.mockReset();
    mocks.extraction.startExtraction.mockResolvedValue({ isExisting: false });
  });

  it('opens a private photo draft while retaining every selected source image', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ExtractScreen />);
    });

    await act(async () => {
      touchableWithText(renderer!, 'Import Screenshots or Photos')!.props.onPress();
    });
    const chooseAction = mocks.alert.mock.calls.at(-1)?.[2]
      .find((action: { text: string }) => action.text === 'Choose Screenshots or Photos');
    await act(async () => {
      await chooseAction.onPress();
    });

    const extractButton = renderer!.root.findAllByType(
      'Button' as unknown as React.ComponentType,
    ).find(node => node.props.children === 'Extract Recipe from 2 Images')!;
    await act(async () => {
      await extractButton.props.onPress();
    });

    const failure = mocks.alert.mock.calls.find(([title]) => title === 'Choose One Recipe');
    const recoverAction = failure?.[2]
      .find((action: { text: string }) => action.text === 'Use Image & Enter Manually');
    await act(async () => recoverAction.onPress());

    expect(mocks.push).toHaveBeenCalledWith({
      pathname: '/add-recipe',
      params: {
        captureSource: 'photo',
        fromOcr: 'true',
        initialImageUri: 'file:///recipe-front.jpg',
      },
    });
    expect(renderer!.root.findAllByType(
      'Image' as unknown as React.ComponentType,
    ).map(node => node.props.source.uri)).toEqual([
      'file:///recipe-front.jpg',
      'file:///recipe-back.jpg',
    ]);
  });

  it('waits for an explicit review action after a completed link import', async () => {
    mocks.extraction.isComplete = true;
    mocks.extraction.currentStep = 'complete';
    mocks.extraction.progress = 100;
    mocks.extraction.recipeId = 'completed-recipe';

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ExtractScreen />);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
    });

    expect(mocks.push).not.toHaveBeenCalled();
    const reviewButton = renderer!.root.findAllByType(
      'Button' as unknown as React.ComponentType,
    ).find(node => node.props.children === 'Review Recipe')!;
    await act(async () => reviewButton.props.onPress());

    expect(mocks.extraction.reset).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith('/recipe/completed-recipe');
  });

  it('keeps new imports disabled until durable recovery finishes', async () => {
    mocks.extraction.isPreparing = true;

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ExtractScreen />);
    });

    const preparingButton = renderer!.root.findAllByType(
      'Button' as unknown as React.ComponentType,
    ).find(node => node.props.children === 'Preparing Imports...')!;
    expect(preparingButton.props.disabled).toBe(true);
  });

  it('restores the original link options when restarting a failed import', async () => {
    mocks.extraction.isFailed = true;
    mocks.extraction.error = 'Could not read the page';
    mocks.extraction.sourceUrl = 'https://example.com/recipe';
    mocks.extraction.sourceLocation = 'Hawaii';
    mocks.extraction.sourceNotes = 'Use the caption measurements';
    mocks.extraction.requestedIsPublic = true;
    mocks.extraction.reset.mockImplementationOnce(async () => {
      mocks.extraction.isFailed = false;
      mocks.extraction.error = null;
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ExtractScreen />);
    });
    const startAgain = renderer!.root.findAllByType(
      'Button' as unknown as React.ComponentType,
    ).find(node => node.props.children === 'Start Again')!;
    await act(async () => startAgain.props.onPress());

    const linkInput = renderer!.root.findByProps({
      placeholder: 'TikTok, Instagram, YouTube, or recipe website link',
    });
    expect(linkInput.props.value).toBe('https://example.com/recipe');
    expect(renderer!.root.findByProps({ label: 'Hawaii' }).props.selected).toBe(true);
    expect(renderer!.root.findByProps({
      accessibilityLabel: 'Share recipe to the public library',
    }).props.accessibilityState.checked).toBe(true);

    const extractButton = renderer!.root.findAllByType(
      'Button' as unknown as React.ComponentType,
    ).find(node => node.props.children === 'Extract Recipe')!;
    await act(async () => extractButton.props.onPress());
    expect(mocks.extraction.startExtraction).toHaveBeenCalledWith({
      url: 'https://example.com/recipe',
      location: 'Hawaii',
      notes: 'Use the caption measurements',
      is_public: true,
    });
  });
});

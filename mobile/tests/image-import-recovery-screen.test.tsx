import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  focused: true,
  ownerId: 'owner-a',
  inboxEntries: [] as any[],
  addInbox: vi.fn(async () => undefined),
  claimInbox: vi.fn(async () => undefined),
  pendingShareCount: 0,
  queueChanged: null as null | ((event: { pendingCount: number }) => void),
  getShareIntent: vi.fn(),
  alert: vi.fn(),
  save: vi.fn(async () => ({ id: 'captured-recipe' })),
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

vi.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
vi.mock('expo-share-intent', () => ({
  ShareIntentModule: {
    addListener: vi.fn((_name: string, callback: (event: { pendingCount: number }) => void) => {
      mocks.queueChanged = callback;
      return { remove: vi.fn() };
    }),
    getPendingShareCount: vi.fn(async () => mocks.pendingShareCount),
    getShareIntent: mocks.getShareIntent,
  },
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
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: mocks.push, replace: vi.fn(), setParams: vi.fn() }),
    useFocusEffect: (callback: () => void) => {
      useEffect(() => { if (mocks.focused) return callback(); }, [callback, mocks.focused]);
    },
  };
});
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
vi.mock('@/hooks/useRecipes', () => ({
  useSaveCapturedRecipe: () => ({ mutateAsync: mocks.save }),
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
vi.mock('@/lib/shareCapture', () => ({ consumePendingShareCapture: () => null, stagePendingShareCapture: () => 'token' }));
vi.mock('@/hooks/useImportInbox', () => ({ useImportInbox: () => ({ ownerId: mocks.ownerId, entries: mocks.inboxEntries, storageError: null }) }));
vi.mock('@/lib/importInbox', () => ({ importInbox: { add: mocks.addInbox, claim: mocks.claimInbox, patch: vi.fn(), remove: vi.fn() } }));
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
    mocks.focused = true; mocks.ownerId = 'owner-a';
    mocks.pendingShareCount = 0;
    mocks.queueChanged = null;
    mocks.getShareIntent.mockReset();
    mocks.save.mockReset();
    mocks.save.mockResolvedValue({ id: 'captured-recipe' });
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
    mocks.extraction.reset.mockReset();
    mocks.extraction.reset.mockResolvedValue(undefined);
    mocks.extraction.startExtraction.mockReset();
    mocks.extraction.startExtraction.mockResolvedValue({ isExisting: false });
  });

  it('locks Open next until native acknowledgement updates the queue count', async () => {
    vi.useFakeTimers();
    mocks.pendingShareCount = 2;
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<ExtractScreen />); });
      await act(async () => { vi.advanceTimersByTime(400); });
      const openNext = touchableWithText(renderer, 'Open next')!;

      await act(async () => {
        openNext.props.onPress();
        openNext.props.onPress();
      });
      expect(mocks.getShareIntent).toHaveBeenCalledExactlyOnceWith('');
      expect(touchableWithText(renderer, 'Open next')!.props.disabled).toBe(true);
      const waitingCopy = () => renderer.root.findAllByType(
        'ThemedText' as unknown as React.ComponentType,
      ).map(node => Array.isArray(node.props.children)
        ? node.props.children.join('')
        : node.props.children);
      expect(waitingCopy()).toContain('2 shared recipes ready to sync');
      await act(async () => { vi.advanceTimersByTime(6_000); });
      expect(touchableWithText(renderer, 'Open next')!.props.disabled).toBe(true);

      await act(async () => { mocks.queueChanged?.({ pendingCount: 1 }); });
      expect(waitingCopy()).toContain('1 shared recipe ready to sync');
      expect(touchableWithText(renderer, 'Open next')!.props.disabled).toBe(false);
    } finally {
      await act(async () => renderer?.unmount());
      vi.useRealTimers();
    }
  });

  it('does not save A images under B after a delayed extraction', async () => {
    let finish!: (value: any) => void;
    mocks.extractMultiple.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => touchableWithText(renderer, 'Import Screenshots or Photos')!.props.onPress());
    const chooseAction = mocks.alert.mock.calls.at(-1)?.[2].find((action: { text: string }) => action.text === 'Choose Screenshots or Photos');
    await act(async () => { await chooseAction.onPress(); });
    let submit!: Promise<void>;
    await act(async () => { submit = renderer.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Import Recipe from 2 Images')!.props.onPress(); });
    mocks.ownerId = 'owner-b';
    await act(async () => renderer.update(<ExtractScreen />));
    await act(async () => { finish({ success: true, recipe: { title: 'A images', components: [] } }); await submit; });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
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
    ).find(node => node.props.children === 'Import Recipe from 2 Images')!;
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

  it.each([false, true])('keeps a completed import available without navigation, including uncertainty=%s', async (uncertain) => {
    mocks.extraction.isComplete = true;
    mocks.extraction.lowConfidence = uncertain;
    mocks.extraction.recipeId = 'completed-recipe';
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.extraction.reset).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType('Button' as unknown as React.ComponentType).some(node => node.props.children === 'Open Recipe')).toBe(true);
    await act(async () => renderer!.unmount());
  });

  it('keeps the next draft and waiting capture when the previous job completes', async () => {
    mocks.extraction.isExtracting = true;
    mocks.inboxEntries = [{ id: 'b', ownerId: 'owner-a', state: 'ready', capture: { kind: 'url', url: 'https://example.com/b' } }];
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => renderer!.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' }).props.onChangeText('https://example.com/c'));
    mocks.extraction.isExtracting = false;
    mocks.extraction.isComplete = true;
    mocks.extraction.recipeId = 'recipe-a';
    await act(async () => renderer!.update(<ExtractScreen />));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.extraction.reset).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' }).props.value).toBe('https://example.com/c');
    expect(mocks.inboxEntries[0].id).toBe('b');
    await act(async () => renderer!.unmount());
    mocks.inboxEntries = [];
  });

  it('opens a completed recipe only after an explicit action and preserves the next draft', async () => {
    mocks.extraction.isComplete = true;
    mocks.extraction.recipeId = 'saved-recipe';
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => renderer!.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' }).props.onChangeText('https://example.com/next'));
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => renderer!.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Open Recipe')!.props.onPress());
    expect(mocks.push).toHaveBeenCalledWith('/recipe/saved-recipe');
    expect(renderer!.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' }).props.value).toBe('https://example.com/next');
    await act(async () => renderer!.unmount());
  });

  it('does not redirect a recipe re-extraction from the import screen', async () => {
    mocks.extraction.isComplete = true;
    mocks.extraction.jobKind = 'reextract';
    mocks.extraction.recipeId = 're-extracted-recipe';
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => renderer!.unmount());
  });

  it('queues another link while the current extraction is running', async () => {
    mocks.extraction.isExtracting = true;
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => renderer!.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' }).props.onChangeText('https://example.com/b'));
    await act(async () => renderer!.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Add to Queue')!.props.onPress());
    expect(mocks.addInbox).toHaveBeenCalledWith(expect.objectContaining({ state: 'ready', capture: { kind: 'url', url: 'https://example.com/b' } }));
    expect(mocks.extraction.reset).not.toHaveBeenCalled();
    expect(mocks.extraction.startExtraction).not.toHaveBeenCalled();
    await act(async () => renderer!.unmount());
  });

  it.each(['duplicate', 'storage'] as const)('retains B while intake A awaits %s', async (boundary) => {
    let finish!: () => void;
    if (boundary === 'duplicate') mocks.checkDuplicate.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ exists: false }); }));
    else mocks.addInbox.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    const input = () => renderer.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' });
    await act(async () => input().props.onChangeText('https://example.com/a'));
    let submit!: Promise<void>;
    await act(async () => { submit = renderer.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Extract Recipe')!.props.onPress(); });
    await act(async () => input().props.onChangeText('https://example.com/b'));
    await act(async () => { finish(); await submit; });
    expect(mocks.addInbox).toHaveBeenCalledWith(expect.objectContaining({ capture: { kind: 'url', url: 'https://example.com/a' } }));
    expect(input().props.value).toBe('https://example.com/b');
    await act(async () => renderer.unmount());
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

  it('retries the original failed import without overwriting the next draft', async () => {
    mocks.extraction.isFailed = true;
    mocks.extraction.error = 'Could not read the page';
    mocks.extraction.sourceUrl = 'https://example.com/recipe';
    mocks.extraction.sourceLocation = 'Hawaii';
    mocks.extraction.sourceNotes = 'Use the caption measurements';
    mocks.extraction.requestedIsPublic = true;
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => renderer!.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' }).props.onChangeText('https://example.com/next'));
    await act(async () => renderer!.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Retry Import')!.props.onPress());
    expect(mocks.addInbox).toHaveBeenCalledWith(expect.objectContaining({ request: { url: 'https://example.com/recipe', location: 'Hawaii', notes: 'Use the caption measurements', is_public: true } }));
    expect(renderer!.root.findByProps({ placeholder: 'TikTok, Instagram, YouTube, or recipe website link' }).props.value).toBe('https://example.com/next');
    await act(async () => renderer!.unmount());
  });

  it('keeps extracted images recoverable after a failed automatic save', async () => {
    const recipe = { title: 'Red Rice', components: [] };
    mocks.extractMultiple.mockResolvedValueOnce({ success: true, recipe } as any);
    mocks.save.mockRejectedValueOnce(new Error('Offline'));
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => touchableWithText(renderer!, 'Import Screenshots or Photos')!.props.onPress());
    const choose = mocks.alert.mock.calls.at(-1)?.[2].find((action: { text: string }) => action.text === 'Choose Screenshots or Photos');
    await act(async () => choose.onPress());
    await act(async () => renderer!.root.findAllByType('Button' as unknown as React.ComponentType)
      .find(node => node.props.children === 'Import Recipe from 2 Images')!.props.onPress());
    expect(mocks.extractMultiple).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith({ pathname: '/ocr-review', params: {
      recipe: JSON.stringify(recipe), sourceType: 'photo', isPublic: 'true', location: 'Guam', saveFailed: 'true',
      captureId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', captureOwnerId: 'owner-a', saveErrorKind: 'retry', saveErrorMessage: 'Offline',
    } });
  });

});

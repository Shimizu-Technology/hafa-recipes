import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  focused: true,
  ownerId: 'owner-a' as string | null,
  signedIn: true, authLoaded: true,
  params: { sharedUrl: undefined as string | undefined, sharedReceiptId: undefined as string | undefined },
  uuid: vi.fn(),
  setParams: vi.fn(),
  inboxEntries: [] as any[],
  addInbox: vi.fn(async (_entry: any) => undefined),
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
  clipboard: vi.fn(async () => 'https://example.com/copied'),
}));

vi.mock('expo-clipboard', () => ({ getStringAsync: mocks.clipboard }));
vi.mock('@/components/RecipeChatModal', () => ({ default: () => null }));
vi.mock('expo-crypto', () => ({ randomUUID: mocks.uuid }));
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
    Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: vi.fn() }) },
    Modal: (props: Record<string, unknown>) => props.visible ? ReactModule.createElement('Modal', props, props.children as React.ReactNode) : null,
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
    useLocalSearchParams: () => mocks.params,
    useRouter: () => ({ push: mocks.push, replace: vi.fn(), setParams: mocks.setParams }),
    useFocusEffect: (callback: () => void) => {
      useEffect(() => { if (mocks.focused) return callback(); }, [callback, mocks.focused]);
    },
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const ReactModule = await import('react');
  const host = (props: Record<string, unknown>) => ReactModule.createElement('SafeAreaView', props, props.children as React.ReactNode);
  return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }), SafeAreaProvider: host, SafeAreaView: host };
});
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: mocks.signedIn, isLoaded: mocks.authLoaded }) }));
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
vi.mock('@/lib/importInbox', () => ({ importInbox: { hydrate: async () => undefined, snapshot: () => mocks.inboxEntries, add: mocks.addInbox, claim: mocks.claimInbox, patch: vi.fn(), remove: vi.fn() } }));
vi.mock('@/hooks/usePublishingDisclosure', () => ({
  usePublishingDisclosure: () => ({
    requestPublishing: mocks.requestPublishing,
    isCheckingDisclosure: false,
  }),
}));
vi.mock('@/lib/imageImportClassification', async () => (
  await import('../lib/imageImportClassification')
));

import { legacyShareReceipts } from '@/lib/legacyShareReceipts';
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
    mocks.focused = true; mocks.ownerId = 'owner-a'; mocks.signedIn = true; mocks.authLoaded = true;
    legacyShareReceipts.clearRoute();
    mocks.uuid.mockReset(); mocks.uuid.mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    mocks.params.sharedUrl = undefined; mocks.params.sharedReceiptId = undefined; mocks.setParams.mockReset();
    mocks.addInbox.mockReset(); mocks.addInbox.mockResolvedValue(undefined); mocks.claimInbox.mockClear();
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
    mocks.clipboard.mockReset();
    mocks.clipboard.mockResolvedValue('https://example.com/copied');
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

  it('keeps settings separate from help and retains notes and visibility after closing', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    const touchable = (label: string) => renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
      .find(node => node.props.accessibilityLabel === label)!;
    expect(renderer.root.findAllByType('Modal' as unknown as React.ComponentType)).toHaveLength(0);
    await act(async () => touchable('Import settings').props.onPress());
    await act(async () => touchable('Private').props.onPress());
    await act(async () => touchable('Cost estimate location, Guam').props.onPress());
    await act(async () => touchable('Hawaii').props.onPress());
    expect(touchable('Cost estimate location, Hawaii').props.accessibilityState.expanded).toBe(false);
    await act(async () => renderer.root.findAllByType('Input' as unknown as React.ComponentType)
      .find(node => node.props.accessibilityLabel === 'Personal notes')!.props.onChangeText('Less sugar'));
    await act(async () => touchable('Done with import settings').props.onPress());
    expect(renderer.root.findAllByType('Modal' as unknown as React.ComponentType)).toHaveLength(0);
    expect(touchable('Import settings').props.accessibilityHint).toContain('Private. Only you');
    expect(touchable('Import settings').props.accessibilityHint).toContain('Personal notes added');
    expect(touchable('Import settings').props.accessibilityHint).toContain('Hawaii');
    await act(async () => touchable('Import settings').props.onPress());
    expect(renderer.root.findAllByType('Input' as unknown as React.ComponentType)
      .find(node => node.props.accessibilityLabel === 'Personal notes')!.props.value).toBe('Less sugar');
    await act(async () => renderer.unmount());
  });

  it.each(['edit', 'account', 'unmount'] as const)('does not overwrite a newer draft after a clipboard %s race', async (change) => {
    let finish!: (text: string) => void;
    mocks.clipboard.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => renderer.root.findAllByType('TouchableOpacity' as unknown as React.ComponentType)
      .find(node => node.props.accessibilityLabel === 'Paste recipe link')!.props.onPress());
    const input = () => renderer.root.findAllByType('Input' as unknown as React.ComponentType)
      .find(node => node.props.accessibilityLabel === 'Recipe link')!;
    if (change === 'edit') await act(async () => input().props.onChangeText('https://example.com/newer'));
    if (change === 'account') { mocks.ownerId = 'owner-b'; await act(async () => renderer.update(<ExtractScreen />)); }
    if (change === 'unmount') await act(async () => renderer.unmount());
    await act(async () => finish('https://example.com/stale'));
    if (change !== 'unmount') {
      expect(input().props.value).toBe(change === 'edit' ? 'https://example.com/newer' : '');
      await act(async () => renderer.unmount());
    }
  });

  it('preserves a retained URL receipt through delayed A unmount and B remount, then allows a later identical share', async () => {
    mocks.params.sharedUrl = 'https://example.com/shared';
    mocks.uuid.mockReturnValueOnce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').mockReturnValueOnce('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    mocks.setParams.mockImplementation((patch: Partial<typeof mocks.params>) => { Object.assign(mocks.params, patch); });
    let finish!: () => void;
    mocks.addInbox.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => renderer.unmount());
    mocks.ownerId = 'owner-b';
    await act(async () => { renderer = create(<ExtractScreen />); });
    expect(mocks.addInbox).toHaveBeenCalledOnce();
    expect(mocks.params.sharedReceiptId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(mocks.setParams.mock.invocationCallOrder[0]).toBeLessThan(mocks.addInbox.mock.invocationCallOrder[0]);
    expect(mocks.addInbox.mock.calls[0][0]).toMatchObject({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ownerId: 'owner-a' });
    await act(async () => finish());
    expect(mocks.params).toMatchObject({ sharedUrl: undefined, sharedReceiptId: undefined });
    await act(async () => renderer.update(<ExtractScreen />));
    mocks.params.sharedUrl = 'https://example.com/shared';
    await act(async () => renderer.update(<ExtractScreen />));
    expect(mocks.addInbox).toHaveBeenCalledTimes(2);
    expect(mocks.addInbox.mock.calls[1][0]).toMatchObject({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerId: 'owner-b', state: 'ready' });
    await act(async () => renderer.unmount());
  });

  it('persists one legacy URL receipt while a delayed write spans an account transition', async () => {
    mocks.params.sharedUrl = 'https://example.com/shared';
    let finish!: () => void;
    mocks.addInbox.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    mocks.ownerId = 'owner-b';
    await act(async () => renderer.update(<ExtractScreen />));
    expect(mocks.addInbox).toHaveBeenCalledOnce();
    await act(async () => finish());
    await act(async () => renderer.update(<ExtractScreen />));
    expect(mocks.addInbox).toHaveBeenCalledOnce();
    expect(mocks.addInbox.mock.calls[0][0]).toMatchObject({ ownerId: 'owner-a', state: 'ready', capture: { url: 'https://example.com/shared' } });
    expect(mocks.setParams).toHaveBeenCalledWith({ sharedUrl: undefined, sharedReceiptId: undefined });
    await act(async () => renderer.unmount());
  });

  it.each(['signed-out', 'identity-pending'] as const)('stores %s legacy shares unassigned until an explicit claim', async (state) => {
    mocks.params.sharedUrl = 'https://example.com/shared'; mocks.ownerId = null;
    mocks.signedIn = state !== 'signed-out';
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    expect(mocks.addInbox.mock.calls[0][0]).toMatchObject({ ownerId: null, state: 'waiting' });
    mocks.signedIn = true; mocks.ownerId = 'owner-b';
    await act(async () => renderer.update(<ExtractScreen />));
    expect(mocks.addInbox).toHaveBeenCalledOnce(); expect(mocks.claimInbox).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('retries the same failed receipt ID and owner instead of assigning the new account', async () => {
    mocks.params.sharedUrl = 'https://example.com/shared';
    mocks.addInbox.mockRejectedValueOnce(new Error('Disk unavailable'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    const original = mocks.addInbox.mock.calls[0][0];
    const retry = mocks.alert.mock.calls.find(([title]) => title === 'Could Not Save Import')?.[2].find((action: { text: string }) => action.text === 'Retry');
    await act(async () => retry.onPress());
    expect(mocks.addInbox.mock.calls[1][0]).toEqual(original);
    mocks.ownerId = 'owner-b';
    await act(async () => renderer.update(<ExtractScreen />));
    expect(mocks.addInbox).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
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
    await act(async () => touchableWithText(renderer, 'Scan photos or screenshots')!.props.onPress());
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
      touchableWithText(renderer!, 'Scan photos or screenshots')!.props.onPress();
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
    await act(async () => renderer!.root.findByProps({ placeholder: 'Paste a recipe link' }).props.onChangeText('https://example.com/c'));
    mocks.extraction.isExtracting = false;
    mocks.extraction.isComplete = true;
    mocks.extraction.recipeId = 'recipe-a';
    await act(async () => renderer!.update(<ExtractScreen />));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.extraction.reset).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ placeholder: 'Paste a recipe link' }).props.value).toBe('https://example.com/c');
    expect(mocks.inboxEntries[0].id).toBe('b');
    await act(async () => renderer!.unmount());
    mocks.inboxEntries = [];
  });

  it('opens a completed recipe only after an explicit action and preserves the next draft', async () => {
    mocks.extraction.isComplete = true;
    mocks.extraction.recipeId = 'saved-recipe';
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => renderer!.root.findByProps({ placeholder: 'Paste a recipe link' }).props.onChangeText('https://example.com/next'));
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => renderer!.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Open Recipe')!.props.onPress());
    expect(mocks.push).toHaveBeenCalledWith('/recipe/saved-recipe');
    expect(renderer!.root.findByProps({ placeholder: 'Paste a recipe link' }).props.value).toBe('https://example.com/next');
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
    await act(async () => renderer!.root.findByProps({ placeholder: 'Paste a recipe link' }).props.onChangeText('https://example.com/b'));
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
    const input = () => renderer.root.findByProps({ placeholder: 'Paste a recipe link' });
    await act(async () => input().props.onChangeText('https://example.com/a'));
    let submit!: Promise<void>;
    await act(async () => { submit = renderer.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Import Recipe')!.props.onPress(); });
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
    await act(async () => renderer!.root.findByProps({ placeholder: 'Paste a recipe link' }).props.onChangeText('https://example.com/next'));
    await act(async () => renderer!.root.findAllByType('Button' as unknown as React.ComponentType).find(node => node.props.children === 'Retry Import')!.props.onPress());
    expect(mocks.addInbox).toHaveBeenCalledWith(expect.objectContaining({ request: { url: 'https://example.com/recipe', location: 'Hawaii', notes: 'Use the caption measurements', is_public: true } }));
    expect(renderer!.root.findByProps({ placeholder: 'Paste a recipe link' }).props.value).toBe('https://example.com/next');
    await act(async () => renderer!.unmount());
  });

  it('keeps extracted images recoverable after a failed automatic save', async () => {
    const recipe = { title: 'Red Rice', components: [] };
    mocks.extractMultiple.mockResolvedValueOnce({ success: true, recipe } as any);
    mocks.save.mockRejectedValueOnce(new Error('Offline'));
    let renderer: ReactTestRenderer;
    await act(async () => { renderer = create(<ExtractScreen />); });
    await act(async () => touchableWithText(renderer!, 'Scan photos or screenshots')!.props.onPress());
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

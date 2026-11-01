vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./ChatScopeChips', () => ({ ChatScopeChips: 'ChatScopeChips' }));
import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Recipe } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const storageValues = new Map<string, string>();
  return {
    storageValues,
    getItem: vi.fn<(key: string) => Promise<string | null>>(),
    setItem: vi.fn<(key: string, value: string) => Promise<void>>(async (key, value) => {
      storageValues.set(key, value);
    }),
    removeItem: vi.fn<(key: string) => Promise<void>>(async (key) => {
      storageValues.delete(key);
    }),
    getCurrentUserIdentity: vi.fn(async () => ({ id: 'stable-user' })),
    deleteChatImages: vi.fn(async () => ({ deleted: 1 })),
    recipeMutate: vi.fn<(variables: unknown) => Promise<{ response: string }>>(),
    cookingMutate: vi.fn<(variables: unknown) => Promise<{ response: string }>>(),
    requestLibraryPermission: vi.fn(async () => ({ status: 'granted' })),
    launchImageLibrary: vi.fn(),
    requestCameraPermission: vi.fn(async () => ({ status: 'granted' })),
    launchCamera: vi.fn(),
    speak: vi.fn<(text?: string) => Promise<void>>(async () => undefined),
    stop: vi.fn<() => Promise<void>>(async () => undefined),
    hasClipboardImage: vi.fn(async () => false),
    getClipboardImage: vi.fn(),
    getClipboardString: vi.fn(async () => ''),
    nativePasteAvailable: true,
    ttsState: { isLoading: false, isPlaying: false },
    speechListeners: new Map<string, (event?: any) => void>(),
    speechStart: vi.fn(),
    speechStop: vi.fn(),
    speechAbort: vi.fn(),
    speechPermissions: vi.fn(async () => ({ granted: true })),
    speechAvailable: vi.fn(() => true),
    alert: vi.fn(),
    trackChatEvent: vi.fn(),
    clerkUserId: 'clerk-subject' as string | null,
  };
});

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: mocks.clerkUserId }) }));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: mocks.alert },
  Image: 'Image',
  Keyboard: { dismiss: vi.fn() },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Linking: {
    openSettings: vi.fn(async () => undefined),
    openURL: vi.fn(async () => undefined),
  },
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
    removeItem: mocks.removeItem, getAllKeys:async()=>[...mocks.storageValues.keys()],multiRemove:async(ks:string[])=>{ks.forEach(k=>mocks.storageValues.delete(k))},
  },
}));
vi.mock('expo-clipboard', () => ({
  ClipboardPasteButton: 'ClipboardPasteButton',
  get isPasteButtonAvailable() { return mocks.nativePasteAvailable; },
  setStringAsync: vi.fn(async () => undefined),
  hasImageAsync: mocks.hasClipboardImage,
  getImageAsync: mocks.getClipboardImage,
  getStringAsync: mocks.getClipboardString,
}));
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success' },
}));
vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: mocks.requestLibraryPermission,
  launchImageLibraryAsync: mocks.launchImageLibrary,
  requestCameraPermissionsAsync: mocks.requestCameraPermission,
  launchCameraAsync: mocks.launchCamera,
}));
vi.mock('../lib/speechRecognition', () => ({
  chatSpeechRecognitionModule: {
    abort: mocks.speechAbort,
    isRecognitionAvailable: mocks.speechAvailable,
    requestPermissionsAsync: mocks.speechPermissions,
    start: mocks.speechStart,
    stop: mocks.speechStop,
  },
  isChatSpeechRecognitionAvailable: true,
  useChatSpeechRecognitionEvent: (eventName: string, listener: (event?: any) => void) => {
    mocks.speechListeners.set(eventName, listener);
  },
}));
vi.mock('../lib/chatTelemetry', () => ({ trackChatEvent: mocks.trackChatEvent }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@believer/react-native-markdown-display', () => ({ Markdown: 'Text' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  View: 'View',
  useColors: () => ({
    background: '#fff',
    backgroundElevated: '#fffdf8',
    backgroundSecondary: '#eee',
    border: '#ddd',
    card: '#fff',
    error: '#b00',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#444',
    tint: '#5DD3B6',
    onTint: '#00261F', onError: '#00261F',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontFamily: {
    bold: 'DMSans_700Bold',
    display: 'Fraunces_700Bold',
    displaySemibold: 'Fraunces_600SemiBold',
    medium: 'DMSans_500Medium',
    regular: 'DMSans_400Regular',
    semibold: 'DMSans_600SemiBold',
  },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 22 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { xs: 4, md: 12, lg: 16, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
}));
vi.mock('@/hooks/useChat', () => ({
  useChatWithRecipe: () => ({ mutateAsync: mocks.recipeMutate }),
  useCookingChat: () => ({ mutateAsync: mocks.cookingMutate }),
}));
vi.mock('@/hooks/useTTS', () => ({
  useTTS: () => ({
    speak: mocks.speak,
    stop: mocks.stop,
    isPlaying: mocks.ttsState.isPlaying,
    isLoading: mocks.ttsState.isLoading,
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock('@/lib/api', () => ({
  default: {
    uploadChatImage: vi.fn(),
    getCurrentUserIdentity: mocks.getCurrentUserIdentity,
    deleteChatImages: mocks.deleteChatImages,
  },
}));

import RecipeChatModal from './RecipeChatModal';
import ChatComposer from './ChatComposer';
import {offlineRecipes} from '../lib/offlineRecipes';
import {chatStorageKey,chatDraftStorageKey} from '../lib/chatStorage';
import { resetChatImageCleanupForTests } from '../lib/chatImageCleanup';
import { resetChatDraftsForTests } from '../lib/chatDrafts';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

/** Create a manually settled promise for deterministic async race tests. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Match the abort shape emitted by fetch when a request is cancelled. */
function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/** Build the minimum recipe shape needed by the chat modal. */
function recipe(id: string): Recipe {
  return { id, extracted: { title: id } } as Recipe;
}

/** Render or rerender the modal for one recipe and flush its effects. */
async function renderModal(renderer: ReturnType<typeof createRoot>, recipeId: string) {
  await act(async () => {
    renderer.render(React.createElement(RecipeChatModal, {
      isVisible: true,
      onClose: vi.fn(),
      recipe: recipe(recipeId),
    }));
  });
}

/** Submit a text message without awaiting the deliberately pending mutation. */
async function sendText(renderer: ReturnType<typeof createRoot>, text: string) {
  const input = renderer.container.queryAll((instance) => instance.type === 'TextInput')[0];
  await act(async () => input.props.onChangeText(text));
  const updatedInput = renderer.container.queryAll(
    (instance) => instance.type === 'TextInput',
  )[0];
  await act(async () => {
    void updatedInput.props.onSubmitEditing();
    await Promise.resolve();
  });
}

/** Expand the composer's attachment options. */
async function openAttachmentOptions(renderer: ReturnType<typeof createRoot>) {
  const addButton = renderer.container.queryAll(
    (instance) => instance.props.accessibilityLabel === 'Add attachment',
  )[0];
  await act(async () => addButton.props.onPress());
}

describe('RecipeChatModal conversation isolation', () => {
  beforeEach(() => {
    mocks.storageValues.clear();
    mocks.getItem.mockReset();
    mocks.getItem.mockImplementation(async (key: string) => mocks.storageValues.get(key) ?? null);
    mocks.setItem.mockReset();
    mocks.setItem.mockImplementation(async (key: string, value: string) => {
      mocks.storageValues.set(key, value);
    });
    mocks.removeItem.mockReset();
    mocks.removeItem.mockImplementation(async (key: string) => {
      mocks.storageValues.delete(key);
    });
    mocks.getCurrentUserIdentity.mockReset();
    mocks.getCurrentUserIdentity.mockResolvedValue({ id: 'stable-user' });
    mocks.deleteChatImages.mockReset();
    mocks.deleteChatImages.mockResolvedValue({ deleted: 1 });
    mocks.recipeMutate.mockReset();
    mocks.cookingMutate.mockReset();
    mocks.requestLibraryPermission.mockClear();
    mocks.launchImageLibrary.mockReset();
    mocks.requestCameraPermission.mockClear();
    mocks.launchCamera.mockReset();
    mocks.speak.mockClear();
    mocks.stop.mockClear();
    mocks.hasClipboardImage.mockReset();
    mocks.hasClipboardImage.mockResolvedValue(false);
    mocks.getClipboardImage.mockReset();
    mocks.getClipboardString.mockReset();
    mocks.getClipboardString.mockResolvedValue('');
    mocks.nativePasteAvailable = true;
    mocks.ttsState.isLoading = false;
    mocks.ttsState.isPlaying = false;
    mocks.speechListeners.clear();
    mocks.speechStart.mockReset();
    mocks.speechStop.mockReset();
    mocks.speechAbort.mockReset();
    mocks.speechPermissions.mockReset();
    mocks.speechPermissions.mockResolvedValue({ granted: true });
    mocks.speechAvailable.mockReset();
    mocks.speechAvailable.mockReturnValue(true);
    mocks.alert.mockClear();
    mocks.trackChatEvent.mockClear();
    mocks.clerkUserId = 'clerk-subject';
    resetChatImageCleanupForTests();
    resetChatDraftsForTests();
  });


  it('keeps stop and photo-removal icons readable on the dark error fill', async () => {
    const root = createRoot();
    const noop = () => undefined;
    try {
      await act(async () => root.render(<ChatComposer conversationKey="fixture" text="" attachedImageUri="file:///fixture.jpg" isListening={false} isSending isUnavailable={false} isGeneralMode={false} onChangeText={noop} onSend={noop} onCancel={noop} onTakePhoto={noop} onPickImage={noop} onRemoveImage={noop} onMicPress={noop} onNativePaste={noop} onFallbackPaste={noop} />));
      for (const name of ['close', 'stop']) {
        expect(root.container.queryAll(n => n.type === 'Ionicons' && n.props.name === name)[0].props.color).toBe('#00261F');
      }
    } finally { await act(async () => root.unmount()); }
  });

  it('keeps the assistant mark and user message readable on the bright dark-mode tint', async () => {
    mocks.recipeMutate.mockResolvedValue({ response: 'Try a little less salt.' });
    const root = createRoot({ textComponentTypes: ['Text'] });
    try {
      await renderModal(root, 'recipe');
      const mark = root.container.queryAll(node => node.type === 'Ionicons' && node.props.name === 'sparkles' && node.props.size === 18);
      expect(mark).toHaveLength(1);
      expect(mark[0].props.color).toBe('#00261F');
      const input = root.container.queryAll(n => n.type === 'TextInput')[0];
      await act(async () => input.props.onChangeText('How much salt?'));
      expect(root.container.queryAll(n => n.type === 'Ionicons' && n.props.name === 'arrow-up')[0].props.color).toBe('#00261F');
      await sendText(root, 'How much salt?');
      const userText = root.container.queryAll(node => node.type === 'Text' && node.props.children === 'How much salt?');
      expect(userText).toHaveLength(1);
      const resolved = Object.assign({}, ...[userText[0].props.style].flat(Infinity));
      expect(resolved.color).toBe('#00261F');
    } finally { await act(async () => root.unmount()); }
  });

  it('R4 does not write A chat draft on generation-remount cleanup after B is verified', async()=>{
    await offlineRecipes.clear();await offlineRecipes.bindSubject('clerk-subject');await offlineRecipes.verify('clerk-subject','stable-user');
    const root=createRoot();
    try {
      await renderModal(root,'recipe');
      const input=root.container.queryAll(n=>n.type==='TextInput')[0];
      await act(async()=>input.props.onChangeText('A private unsent chat draft'));
      mocks.setItem.mockClear();
      // Both production parents remount chat on generation change; exercise its actual unmount flush.
      await act(async()=>{await offlineRecipes.verify('clerk-subject','owner-b'); root.unmount();});
      console.log('R4 post-retirement chat writes',mocks.setItem.mock.calls);
      expect(mocks.storageValues.get(chatDraftStorageKey(chatStorageKey('stable-user','recipe')))).not.toBe('A private unsent chat draft');
    }finally{await offlineRecipes.clear();}
  });

  it.each([
    ['success', { response: 'origin answer' }, undefined, 'sent'],
    ['interruption', undefined, abortError(), 'cancelled'],
  ])('persists a pending %s to its originating recipe', async (
    _label,
    result,
    error,
    expectedStatus,
  ) => {
    const pendingSend = deferred<{ response: string }>();
    mocks.getItem.mockResolvedValue(null);
    mocks.recipeMutate.mockImplementation(() => pendingSend.promise);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await sendText(renderer, 'hello');
      await renderModal(renderer, 'second');
      if (error) {
        await act(async () => pendingSend.reject(error));
      } else {
        await act(async () => pendingSend.resolve(result!));
      }

      const firstWrites = mocks.setItem.mock.calls.filter(
        ([key]) => key === 'hafa.chat.v2.stable-user.recipe.first',
      );
      expect(firstWrites.length).toBeGreaterThanOrEqual(2);
      const finalMessages = JSON.parse(firstWrites.at(-1)![1]);
      if (error) {
        expect(finalMessages.at(-1).status).toBe(expectedStatus);
      } else {
        expect(finalMessages.at(-1).content).toBe('origin answer');
      }
      expect(mocks.setItem.mock.calls.filter(
        ([key]) => key === 'hafa.chat.v2.stable-user.recipe.second',
      )).toEqual([]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

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
  };
});

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'clerk-subject' }) }));
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
    removeItem: mocks.removeItem,
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
    backgroundSecondary: '#eee',
    border: '#ddd',
    card: '#fff',
    error: '#b00',
    text: '#111',
    textMuted: '#666',
    textSecondary: '#444',
    tint: '#087',
  }),
}));
vi.mock('@/constants/Colors', () => ({
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
    resetChatImageCleanupForTests();
    resetChatDraftsForTests();
  });

  it('ignores a stale history read after switching recipes', async () => {
    const firstLoad = deferred<string | null>();
    const secondLoad = deferred<string | null>();
    mocks.getItem.mockImplementation((key: string) => (
      key === 'hafa.chat.v2.stable-user.recipe.first' ? firstLoad.promise : secondLoad.promise
    ));
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await renderModal(renderer, 'second');
      await act(async () => secondLoad.resolve(JSON.stringify([
        { id: 'second-message', role: 'user', content: 'second history' },
        { id: 'second-answer', role: 'assistant', content: 'second answer' },
      ])));
      await act(async () => firstLoad.resolve(JSON.stringify([
        { id: 'first-message', role: 'user', content: 'stale first history' },
      ])));

      const text = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(text).toContain('second history');
      expect(text).not.toContain('stale first history');
      const copyButtons = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Copy message',
      );
      expect(copyButtons).toHaveLength(2);
      expect(copyButtons.every((button) => button.props.accessibilityRole === 'button')).toBe(true);
      const speechButtons = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Read response aloud',
      );
      expect(speechButtons).toHaveLength(1);
      expect(speechButtons[0].props.accessibilityRole).toBe('button');
      expect(speechButtons[0].props.accessibilityState).toEqual({ disabled: false });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('clears an unsent photo when switching recipes', async () => {
    mocks.getItem.mockResolvedValue(null);
    mocks.launchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ base64: 'cGhvdG8tYQ==', uri: 'file:///recipe-a.jpg' }],
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await openAttachmentOptions(renderer);
      const attachButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Attach photo from library',
      )[0];
      await act(async () => attachButton.props.onPress());
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image'
          && instance.props.source?.uri === 'file:///recipe-a.jpg',
      )).toHaveLength(1);

      await renderModal(renderer, 'second');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image'
          && instance.props.source?.uri === 'file:///recipe-a.jpg',
      )).toHaveLength(0);
      const sendButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Send message',
      )[0];
      expect(sendButton.props.disabled).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows the photo privacy notice when attaching to an existing conversation', async () => {
    mocks.storageValues.set(
      'hafa.chat.v2.stable-user.recipe.first',
      JSON.stringify([{ id: 'question', role: 'user', content: 'Existing message' }]),
    );
    mocks.launchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ base64: 'cGhvdG8=', uri: 'file:///recipe-photo.jpg' }],
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await openAttachmentOptions(renderer);
      const attachButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Attach photo from library',
      )[0];
      await act(async () => attachButton.props.onPress());

      const text = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(text).toContain(
        "Sent to our AI provider and stored with this chat. Don't upload sensitive personal information.",
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('discards an image picker result that resolves after switching recipes', async () => {
    const pendingPicker = deferred<{
      canceled: boolean;
      assets: Array<{ base64: string; uri: string }>;
    }>();
    mocks.getItem.mockResolvedValue(null);
    mocks.launchImageLibrary.mockImplementation(() => pendingPicker.promise);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await openAttachmentOptions(renderer);
      const attachButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Attach photo from library',
      )[0];
      await act(async () => {
        void attachButton.props.onPress();
        await Promise.resolve();
      });
      await renderModal(renderer, 'second');
      await act(async () => pendingPicker.resolve({
        canceled: false,
        assets: [{ base64: 'c3RhbGU=', uri: 'file:///stale.jpg' }],
      }));

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image'
          && instance.props.source?.uri === 'file:///stale.jpg',
      )).toHaveLength(0);
      const sendButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Send message',
      )[0];
      expect(sendButton.props.disabled).toBe(true);
      expect(mocks.recipeMutate).not.toHaveBeenCalled();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('pastes text directly and saves it as an account-scoped draft', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const pasteButton = renderer.container.queryAll(
        (instance) => instance.type === 'ClipboardPasteButton',
      )[0];
      await act(async () => pasteButton.props.onPress({
        type: 'text',
        text: 'Can I use coconut milk?',
      }));

      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      expect(input.props.value).toBe('Can I use coconut milk?');
      await vi.waitFor(() => {
        expect(mocks.storageValues.get(
          'hafa.chat.v2.stable-user.recipe.first.draft',
        )).toBe('Can I use coconut milk?');
      });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('attaches an image directly from the native paste control', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    const imageData = 'data:image/jpeg;base64,/9j/cGFzdGVkLXBob3Rv';

    try {
      await renderModal(renderer, 'first');
      const pasteButton = renderer.container.queryAll(
        (instance) => instance.type === 'ClipboardPasteButton',
      )[0];
      await act(async () => pasteButton.props.onPress({
        type: 'image',
        data: imageData,
        size: { width: 100, height: 100 },
      }));

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image' && instance.props.source?.uri === imageData,
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Remove attached photo',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('restores only the active conversation draft', async () => {
    mocks.storageValues.set(
      'hafa.chat.v2.stable-user.recipe.first.draft',
      'First recipe draft',
    );
    mocks.storageValues.set(
      'hafa.chat.v2.stable-user.recipe.second.draft',
      'Second recipe draft',
    );
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0].props.value).toBe('First recipe draft');

      await renderModal(renderer, 'second');
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0].props.value).toBe('Second recipe draft');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('does not clear a saved draft when switching before history loads', async () => {
    const firstHistory = deferred<string | null>();
    const firstDraftKey = 'hafa.chat.v2.stable-user.recipe.first.draft';
    mocks.storageValues.set(firstDraftKey, 'Keep this saved draft');
    mocks.getItem.mockImplementation(async (key: string) => {
      if (key === 'hafa.chat.v2.stable-user.recipe.first') return firstHistory.promise;
      return mocks.storageValues.get(key) ?? null;
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await renderModal(renderer, 'second');
      expect(mocks.storageValues.get(firstDraftKey)).toBe('Keep this saved draft');

      await act(async () => firstHistory.resolve(null));
      expect(mocks.storageValues.get(firstDraftKey)).toBe('Keep this saved draft');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('exposes speech loading as a disabled button state', async () => {
    const pendingSpeech = deferred<void>();
    mocks.speak.mockImplementation(() => pendingSpeech.promise);
    mocks.getItem.mockResolvedValue(JSON.stringify([
      { id: 'question', role: 'user', content: 'question' },
      { id: 'answer', role: 'assistant', content: 'answer' },
    ]));
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const speechButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Read response aloud',
      )[0];
      expect(speechButton.props.disabled).toBe(false);
      await act(async () => {
        void speechButton.props.onPress();
        await Promise.resolve();
      });
      expect(mocks.speak).toHaveBeenCalledOnce();
      mocks.ttsState.isLoading = true;
      await renderModal(renderer, 'first');
      const loadingSpeechButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Read response aloud',
      )[0];
      expect(loadingSpeechButton.props.disabled).toBe(true);
      expect(loadingSpeechButton.props.accessibilityRole).toBe('button');
      expect(loadingSpeechButton.props.accessibilityState).toEqual({ disabled: true });
    } finally {
      await act(async () => pendingSpeech.resolve());
      await act(async () => renderer.unmount());
    }
  });

  it('replaces interim dictation without duplicating earlier recognition results', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      await act(async () => input.props.onChangeText('Can I use'));
      const mic = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Start voice input',
      )[0];
      await act(async () => mic.props.onPress());

      expect(mocks.speechStart).toHaveBeenCalledWith(expect.objectContaining({
        addsPunctuation: true,
        continuous: false,
        interimResults: true,
      }));
      await act(async () => mocks.speechListeners.get('result')?.({
        isFinal: false,
        results: [{ transcript: 'coconut' }],
      }));
      await act(async () => mocks.speechListeners.get('result')?.({
        isFinal: true,
        results: [{ transcript: 'coconut milk' }],
      }));

      const updatedInput = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      expect(updatedInput.props.value).toBe('Can I use coconut milk');
      const visibleText = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(visibleText).toContain('Listening…');

      const stopMic = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Stop voice input',
      )[0];
      await act(async () => stopMic.props.onPress());
      expect(mocks.speechStop).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps paste controls inert throughout an active dictation session', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      const pasteBeforeDictation = renderer.container.queryAll(
        (instance) => instance.type === 'ClipboardPasteButton',
      )[0].props.onPress;
      const pastedImage = 'data:image/jpeg;base64,/9j/dm9pY2U=';
      await act(async () => pasteBeforeDictation({
        type: 'image',
        data: pastedImage,
        size: { width: 100, height: 100 },
      }));
      await act(async () => input.props.onChangeText('Can I use'));
      const mic = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Start voice input',
      )[0];
      await act(async () => mic.props.onPress());

      const pasteWhileListening = renderer.container.queryAll(
        (instance) => instance.type === 'ClipboardPasteButton',
      )[0];
      expect(pasteWhileListening.props.accessibilityState).toEqual({ disabled: true });
      const removeImage = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Remove attached photo',
      )[0];
      expect(removeImage.props.disabled).toBe(true);
      expect(removeImage.props.accessibilityState).toEqual({ disabled: true });
      await act(async () => removeImage.props.onPress());
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Image' && instance.props.source?.uri === pastedImage,
      )).toHaveLength(1);
      await act(async () => pasteWhileListening.props.onPress({
        type: 'text',
        text: 'current paste while listening',
      }));
      await act(async () => pasteBeforeDictation({
        type: 'text',
        text: 'pasted while listening',
      }));
      await act(async () => mocks.speechListeners.get('result')?.({
        isFinal: true,
        results: [{ transcript: 'coconut milk' }],
      }));

      const updatedInput = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      expect(updatedInput.props.value).toBe('Can I use coconut milk');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps fallback attachment actions inert throughout active dictation', async () => {
    mocks.nativePasteAvailable = false;
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await openAttachmentOptions(renderer);
      const mic = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Start voice input',
      )[0];
      await act(async () => mic.props.onPress());

      const attachmentToggle = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Close attachment options',
      )[0];
      const camera = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Take a photo',
      )[0];
      const photos = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Attach photo from library',
      )[0];
      const fallbackPaste = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Paste from clipboard',
      )[0];
      for (const control of [attachmentToggle, camera, photos, fallbackPaste]) {
        expect(control.props.disabled).toBe(true);
        await act(async () => control.props.onPress());
      }

      expect(mocks.requestCameraPermission).not.toHaveBeenCalled();
      expect(mocks.launchCamera).not.toHaveBeenCalled();
      expect(mocks.requestLibraryPermission).not.toHaveBeenCalled();
      expect(mocks.launchImageLibrary).not.toHaveBeenCalled();
      expect(mocks.hasClipboardImage).not.toHaveBeenCalled();
      expect(mocks.getClipboardString).not.toHaveBeenCalled();
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Close attachment options',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('shows actionable voice errors and aborts dictation when chat closes', async () => {
    const onClose = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(RecipeChatModal, {
          isVisible: true,
          onClose,
          recipe: recipe('first'),
        }));
      });
      const mic = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Start voice input',
      )[0];
      await act(async () => mic.props.onPress());
      await act(async () => mocks.speechListeners.get('error')?.({ error: 'network' }));
      expect(mocks.alert).toHaveBeenCalledWith(
        'Voice Connection Issue',
        expect.stringContaining('Check your connection'),
        [{ text: 'OK' }],
      );

      await act(async () => mic.props.onPress());
      const closeButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Close chat',
      )[0];
      await act(async () => closeButton.props.onPress());
      expect(mocks.speechAbort).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
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

  it('marks a non-aborted service failure as failed', async () => {
    const pendingSend = deferred<{ response: string }>();
    mocks.recipeMutate.mockImplementation(() => pendingSend.promise);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await sendText(renderer, 'Can you help?');
      await act(async () => pendingSend.reject({ response: { status: 503 } }));

      const stored = JSON.parse(mocks.storageValues.get(
        'hafa.chat.v2.stable-user.recipe.first',
      )!);
      expect(stored.at(-1).status).toBe('failed');
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Retry message',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('renders progressive text and lets the user stop a response', async () => {
    const pendingSend = deferred<{ response: string }>();
    let requestSignal: AbortSignal | undefined;
    mocks.recipeMutate.mockImplementation((variables: unknown) => {
      const stream = variables as {
        onDelta?: (delta: string, response: string) => void;
        signal?: AbortSignal;
      };
      requestSignal = stream.signal;
      stream.onDelta?.('Use low heat.', 'Use low heat.');
      return pendingSend.promise;
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await sendText(renderer, 'How should I warm this?');

      expect(requestSignal?.aborted).toBe(false);
      const textDuringStream = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(textDuringStream).toContain('Use low heat.');
      expect(textDuringStream).not.toContain('Thinking...');
      const stopButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Stop generating',
      )[0];
      expect(stopButton.props.disabled).toBe(false);

      await act(async () => stopButton.props.onPress());
      expect(requestSignal?.aborted).toBe(true);
      await act(async () => pendingSend.reject(abortError()));

      const textAfterStop = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(textAfterStop).not.toContain('Use low heat.');
      expect(textAfterStop).toContain('Response stopped.');
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Retry message',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('deletes persisted photos before clearing account-scoped history', async () => {
    const history = JSON.stringify([
      {
        id: 'photo-question',
        role: 'user',
        content: 'What is this?',
        image_url: 'https://images.example/chat-photo.jpg',
      },
      { id: 'answer', role: 'assistant', content: 'A tomato.' },
    ]);
    mocks.storageValues.set('hafa.chat.v2.stable-user.recipe.first', history);
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const clearButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Clear conversation',
      )[0];
      await act(async () => clearButton.props.onPress());
      const confirmation = mocks.alert.mock.calls[0][2][1];
      await act(async () => confirmation.onPress());
      await vi.waitFor(() => {
        expect(mocks.deleteChatImages).toHaveBeenCalledWith([
          'https://images.example/chat-photo.jpg',
        ]);
      });
      expect(mocks.removeItem).toHaveBeenCalledWith(
        'hafa.chat.v2.stable-user.recipe.first',
      );
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Copy message',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('marks the clear control disabled and busy while clearing', async () => {
    const conversationKey = 'hafa.chat.v2.stable-user.recipe.first';
    const pendingRemove = deferred<void>();
    mocks.storageValues.set(
      conversationKey,
      JSON.stringify([{ id: 'question', role: 'user', content: 'Clear me' }]),
    );
    mocks.removeItem.mockImplementation((key: string) => {
      if (key === conversationKey) return pendingRemove.promise;
      mocks.storageValues.delete(key);
      return Promise.resolve();
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const clearButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Clear conversation',
      )[0];
      await act(async () => clearButton.props.onPress());
      const confirmation = mocks.alert.mock.calls[0][2][1];
      await act(async () => {
        void confirmation.onPress();
        await Promise.resolve();
      });

      const busyClearButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Clear conversation',
      )[0];
      expect(busyClearButton.props.disabled).toBe(true);
      expect(busyClearButton.props.accessibilityState).toEqual({
        disabled: true,
        busy: true,
      });
    } finally {
      await act(async () => pendingRemove.resolve());
      await act(async () => renderer.unmount());
    }
  });

  it('queues persisted photo cleanup when remote deletion fails', async () => {
    const history = JSON.stringify([
      {
        id: 'photo-question',
        role: 'user',
        content: 'What is this?',
        image_url: 'https://images.example/chat-photo.jpg',
      },
    ]);
    mocks.storageValues.set('hafa.chat.v2.stable-user.recipe.first', history);
    mocks.deleteChatImages.mockRejectedValueOnce(new Error('offline'));
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const clearButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Clear conversation',
      )[0];
      await act(async () => clearButton.props.onPress());
      const confirmation = mocks.alert.mock.calls[0][2][1];
      await act(async () => confirmation.onPress());
      await vi.waitFor(() => {
        expect(mocks.alert).toHaveBeenCalledWith(
          'Chat Cleared',
          expect.stringContaining('retrying'),
        );
      });

      const queueWrite = mocks.setItem.mock.calls.filter(
        ([key]) => key === 'hafa.chat.v2.stable-user.recipe.first.pending-image-cleanup',
      ).at(-1);
      expect(JSON.parse(queueWrite![1])).toEqual([{
        id: expect.any(String),
        imageUrls: ['https://images.example/chat-photo.jpg'],
        state: 'ready',
      }]);
      expect(mocks.removeItem).toHaveBeenCalledWith('hafa.chat.v2.stable-user.recipe.first');
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Copy message',
      )).toHaveLength(0);
      expect(mocks.storageValues.has(
        'hafa.chat.v2.stable-user.recipe.first.pending-image-cleanup',
      )).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('retries a queued image cleanup before loading the conversation', async () => {
    mocks.storageValues.set(
      'hafa.chat.v2.stable-user.recipe.first.pending-image-cleanup',
      JSON.stringify([{
        id: 'pending-job',
        imageUrls: ['https://images.example/pending.jpg'],
        state: 'ready',
      }]),
    );
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await vi.waitFor(() => {
        expect(mocks.deleteChatImages).toHaveBeenCalledWith([
          'https://images.example/pending.jpg',
        ]);
      });
      expect(mocks.removeItem).toHaveBeenCalledWith(
        'hafa.chat.v2.stable-user.recipe.first.pending-image-cleanup',
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('cleans queued photos even after a new conversation message exists', async () => {
    mocks.storageValues.set(
      'hafa.chat.v2.stable-user.recipe.first.pending-image-cleanup',
      JSON.stringify([{
        id: 'older-cleanup',
        imageUrls: ['https://images.example/pending.jpg'],
        state: 'ready',
      }]),
    );
    mocks.storageValues.set(
      'hafa.chat.v2.stable-user.recipe.first',
      JSON.stringify([{ id: 'question', role: 'user', content: 'Still here' }]),
    );
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await vi.waitFor(() => {
        expect(mocks.deleteChatImages).toHaveBeenCalledWith([
          'https://images.example/pending.jpg',
        ]);
      });
      const text = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(text).toContain('Still here');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('does not delete photos if local conversation removal fails', async () => {
    mocks.storageValues.set(
      'hafa.chat.v2.stable-user.recipe.first',
      JSON.stringify([
      {
        id: 'photo-question',
        role: 'user',
        content: 'Still here',
        image_url: 'https://images.example/pending.jpg',
      },
      ]),
    );
    mocks.removeItem.mockImplementation(async (key: string) => {
      if (key === 'hafa.chat.v2.stable-user.recipe.first') throw new Error('storage failed');
      mocks.storageValues.delete(key);
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const clearButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Clear conversation',
      )[0];
      await act(async () => clearButton.props.onPress());
      const confirmation = mocks.alert.mock.calls[0][2][1];
      await act(async () => confirmation.onPress());

      expect(mocks.deleteChatImages).not.toHaveBeenCalled();
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Copy message',
      )).toHaveLength(1);
      expect(mocks.alert).toHaveBeenCalledWith(
        'Could Not Clear Chat',
        expect.stringContaining('could not remove it'),
      );
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('never deletes current photos when local clear fails during older cleanup', async () => {
    const conversationKey = 'hafa.chat.v2.stable-user.recipe.first';
    const cleanupKey = `${conversationKey}.pending-image-cleanup`;
    const currentImageUrl = 'https://images.example/current.jpg';
    const priorImageUrl = 'https://images.example/prior.jpg';
    const priorDelete = deferred<{ deleted: number }>();
    mocks.storageValues.set(conversationKey, JSON.stringify([{
      id: 'current-photo',
      role: 'user',
      content: 'Keep this photo',
      image_url: currentImageUrl,
    }]));
    mocks.storageValues.set(cleanupKey, JSON.stringify([{
      id: 'prior-clear',
      imageUrls: [priorImageUrl],
      state: 'ready',
    }]));
    mocks.deleteChatImages.mockImplementationOnce(() => priorDelete.promise);
    mocks.removeItem.mockImplementation(async (key: string) => {
      if (key === conversationKey) throw new Error('storage failed');
      mocks.storageValues.delete(key);
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      await vi.waitFor(() => {
        expect(mocks.deleteChatImages).toHaveBeenCalledOnce();
        expect(mocks.deleteChatImages).toHaveBeenCalledWith([priorImageUrl]);
      });

      const clearButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Clear conversation',
      )[0];
      await act(async () => clearButton.props.onPress());
      const confirmation = mocks.alert.mock.calls[0][2][1];
      await act(async () => confirmation.onPress());

      expect(mocks.deleteChatImages).not.toHaveBeenCalledWith([currentImageUrl]);
      expect(mocks.storageValues.get(conversationKey)).toContain(currentImageUrl);
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Copy message',
      )).toHaveLength(1);

      await act(async () => priorDelete.resolve({ deleted: 1 }));
      await vi.waitFor(() => {
        expect(mocks.storageValues.has(cleanupKey)).toBe(false);
      });
      expect(mocks.deleteChatImages).not.toHaveBeenCalledWith([currentImageUrl]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('does not open unscoped legacy history', async () => {
    mocks.getItem.mockImplementation(async (key: string) => (
      key === 'recipe_chat_first'
        ? JSON.stringify([{ role: 'user', content: 'another account history' }])
        : null
    ));
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      expect(mocks.removeItem).toHaveBeenCalledWith('recipe_chat_first');
      expect(mocks.getItem).not.toHaveBeenCalledWith('recipe_chat_first');
      const text = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(text).not.toContain('another account history');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps the composer disabled when scoped history cannot be read', async () => {
    mocks.getItem.mockRejectedValue(new Error('corrupt storage'));
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const text = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(text).toContain(
        'We could not load this conversation. Check your connection and reopen chat.',
      );
      const input = renderer.container.queryAll(
        (instance) => instance.type === 'TextInput',
      )[0];
      const sendButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Send message',
      )[0];
      expect(input.props.editable).toBe(false);
      expect(sendButton.props.disabled).toBe(true);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('aborts a delayed clear confirmation after switching recipes', async () => {
    mocks.getItem.mockImplementation(async (key: string) => {
      if (key.endsWith('.pending-image-cleanup')) return null;
      return JSON.stringify([{
        id: key.includes('.first') ? 'first-photo' : 'second-photo',
        role: 'user',
        content: key.includes('.first') ? 'first' : 'second',
        image_url: key.includes('.first')
          ? 'https://images.example/first.jpg'
          : 'https://images.example/second.jpg',
      }]);
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
      const clearButton = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Clear conversation',
      )[0];
      await act(async () => clearButton.props.onPress());
      const confirmation = mocks.alert.mock.calls[0][2][1];
      await renderModal(renderer, 'second');
      await act(async () => confirmation.onPress());

      expect(mocks.deleteChatImages).not.toHaveBeenCalled();
      expect(mocks.removeItem).not.toHaveBeenCalledWith(
        'hafa.chat.v2.stable-user.recipe.first',
      );
      const text = renderer.container.queryAll(
        (instance) => instance.type === 'Text',
      ).map((instance) => instance.props.children);
      expect(text).toContain('second');
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

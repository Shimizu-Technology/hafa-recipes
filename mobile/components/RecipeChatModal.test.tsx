import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Recipe } from '@/types/recipe';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(async () => undefined),
  removeItem: vi.fn<(key: string) => Promise<void>>(async () => undefined),
  recipeMutate: vi.fn<(variables: unknown) => Promise<{ response: string }>>(),
  cookingMutate: vi.fn<(variables: unknown) => Promise<{ response: string }>>(),
  requestLibraryPermission: vi.fn(async () => ({ status: 'granted' })),
  launchImageLibrary: vi.fn(),
  speak: vi.fn<(text?: string) => Promise<void>>(async () => undefined),
  stop: vi.fn<() => Promise<void>>(async () => undefined),
  ttsState: { isLoading: false, isPlaying: false },
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Image: 'Image',
  Keyboard: { dismiss: vi.fn() },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Linking: { openURL: vi.fn(async () => undefined) },
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
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => undefined) }));
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success' },
}));
vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: mocks.requestLibraryPermission,
  launchImageLibraryAsync: mocks.launchImageLibrary,
  requestCameraPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
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
  }),
}));
vi.mock('@/lib/api', () => ({
  default: { uploadChatImage: vi.fn() },
}));

import RecipeChatModal from './RecipeChatModal';

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

describe('RecipeChatModal conversation isolation', () => {
  beforeEach(() => {
    mocks.getItem.mockReset();
    mocks.setItem.mockClear();
    mocks.removeItem.mockClear();
    mocks.recipeMutate.mockReset();
    mocks.cookingMutate.mockReset();
    mocks.requestLibraryPermission.mockClear();
    mocks.launchImageLibrary.mockReset();
    mocks.speak.mockClear();
    mocks.stop.mockClear();
    mocks.ttsState.isLoading = false;
    mocks.ttsState.isPlaying = false;
  });

  it('ignores a stale history read after switching recipes', async () => {
    const firstLoad = deferred<string | null>();
    const secondLoad = deferred<string | null>();
    mocks.getItem.mockImplementation((key: string) => (
      key === 'recipe_chat_first' ? firstLoad.promise : secondLoad.promise
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
      assets: [{ base64: 'photo-base64', uri: 'file:///recipe-a.jpg' }],
    });
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await renderModal(renderer, 'first');
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
        assets: [{ base64: 'stale-base64', uri: 'file:///stale.jpg' }],
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

  it.each([
    ['success', { response: 'origin answer' }, undefined],
    ['failure', undefined, { response: { status: 503 } }],
  ])('persists a pending %s to its originating recipe', async (_label, result, error) => {
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
        ([key]) => key === 'recipe_chat_first',
      );
      expect(firstWrites.length).toBeGreaterThanOrEqual(2);
      const finalMessages = JSON.parse(firstWrites.at(-1)![1]);
      if (error) {
        expect(finalMessages.at(-1).status).toBe('failed');
      } else {
        expect(finalMessages.at(-1).content).toBe('origin answer');
      }
      expect(mocks.setItem.mock.calls.filter(
        ([key]) => key === 'recipe_chat_second',
      )).toEqual([]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

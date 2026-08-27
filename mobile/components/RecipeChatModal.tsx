/**
 * Recipe Chat Modal - AI-powered recipe assistant.
 * 
 * Allows users to ask questions about a recipe:
 * - Ingredient substitutions
 * - Scaling up/down
 * - Cooking tips
 * - Dietary modifications
 * - Wine pairings
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  ActivityIndicator,
  Alert,
  View as RNView,
  Image,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@clerk/expo';

import { View, Text, useColors } from '@/components/Themed';
import ChatComposer from './ChatComposer';
import { Recipe, ChatMessage } from '@/types/recipe';
import { useChatWithRecipe, useCookingChat } from '@/hooks/useChat';
import { useTTS } from '@/hooks/useTTS';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import {
  Markdown,
  type RenderRules,
} from '@believer/react-native-markdown-display';
import api from '@/lib/api';
import {
  beginMessageDelivery,
  ChatUiMessage,
  completeMessageDelivery,
  createChatMessageId,
  interruptMessageDelivery,
  messagesForStorage,
  normalizeStoredChatMessages,
  selectChatContext,
  upsertStreamingResponse,
} from '../lib/chatContext';
import { chatErrorMessage } from '../lib/chatErrors';
import { isChatAbortError } from '../lib/chatStream';
import { applyVoiceTranscript, chatVoiceError } from '../lib/chatVoice';
import {
  chatSpeechRecognitionModule,
  isChatSpeechRecognitionAvailable,
  useChatSpeechRecognitionEvent,
} from '../lib/speechRecognition';
import {
  appendPastedChatText,
  CHAT_MESSAGE_MAX_CHARS,
  normalizeChatImageAttachment,
  normalizeChatPaste,
} from '../lib/chatComposer';
import { readChatDraft, writeChatDraft } from '../lib/chatDrafts';
import {
  chatStorageKey,
  legacyChatStorageKey,
  persistedChatImageUrls,
} from '../lib/chatStorage';
import {
  activateChatImageCleanup,
  enqueueChatImageCleanup,
  hasChatImageCleanup,
  processChatImageCleanup,
  recoverChatImageCleanup,
  removeChatImageCleanup,
} from '../lib/chatImageCleanup';
const CHAT_MARKDOWN_RULES: RenderRules = {
  // Assistant text must never trigger a remote image request from the device.
  image: () => null,
};

interface RecipeChatModalProps {
  isVisible: boolean;
  onClose: () => void;
  recipe?: Recipe;  // Optional - if not provided, it's general cooking mode
}

// Quick suggestion chips for recipe-specific chat
const RECIPE_SUGGESTIONS = [
  "What substitutions can I make?",
  "Make this dairy-free",
  "Scale for 8 servings",
  "What wine pairs well?",
  "Any tips for this recipe?",
];

// Quick suggestions for general cooking chat
const COOKING_SUGGESTIONS = [
  "What can I make with chicken and rice?",
  "How long does cooked rice last?",
  "What's a good side for salmon?",
  "Is it safe to eat expired eggs?",
  "Difference between baking soda and powder?",
];

/** Render recipe-specific or general cooking chat with local conversation persistence. */
export default function RecipeChatModal({ isVisible, onClose, recipe }: RecipeChatModalProps) {
  const colors = useColors();
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Determine mode: recipe-specific or general cooking
  const isGeneralMode = !recipe;
  const quickSuggestions = isGeneralMode ? COOKING_SUGGESTIONS : RECIPE_SUGGESTIONS;
  const { userId: clerkUserId } = useAuth();
  const [storageKey, setStorageKey] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const messagesRef = useRef<ChatUiMessage[]>([]);
  const retryImagesRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const clearInFlightRef = useRef(false);
  const activeStorageKeyRef = useRef<string | null>(null);
  const loadedStorageKeyRef = useRef<string | null>(null);
  const historyLoadGenerationRef = useRef(0);
  const inputTextRef = useRef('');
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollAtRef = useRef(0);
  const voiceBaseTextRef = useRef('');
  const voiceSessionActiveRef = useRef(false);
  const [inputText, setInputText] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [isDelivering, setIsDelivering] = useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);  // Base64 image
  const [attachedImageUri, setAttachedImageUri] = useState<string | null>(null);  // For preview
  const isComposerUnavailable = isDelivering
    || isClearingChat
    || isLoadingHistory
    || !storageKey
    || loadedStorageKey !== storageKey;
  const hasStreamingResponse = messages.some(
    (message) => message.role === 'assistant' && message.status === 'sending',
  );
  
  // Use appropriate mutation hook based on mode
  const recipeChatMutation = useChatWithRecipe();
  const cookingChatMutation = useCookingChat();
  
  const {
    speak,
    stop,
    isPlaying,
    isLoading: ttsLoading,
    error: ttsError,
    clearError: clearTTSError,
  } = useTTS();

  /** Keep text state synchronized for close and conversation-switch draft saves. */
  const updateInputText = useCallback((text: string) => {
    inputTextRef.current = text;
    setInputText(text);
  }, []);

  const updateLoadedStorageKey = useCallback((key: string | null) => {
    loadedStorageKeyRef.current = key;
    setLoadedStorageKey(key);
  }, []);

  /** Keep render state and the async-safe message reference synchronized. */
  const updateMessages = useCallback((nextMessages: ChatUiMessage[]) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
  }, []);

  /** Open only web links supplied by assistant Markdown. */
  const handleAssistantLink = useCallback((url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('unsupported protocol');
      }
      void Linking.openURL(parsed.toString()).catch(() => {
        Alert.alert('Link unavailable', 'This assistant link could not be opened.');
      });
    } catch {
      Alert.alert('Link unavailable', 'This assistant link cannot be opened safely.');
    }
    return false;
  }, []);

  /** End dictation immediately when chat closes or changes conversations. */
  const cancelVoiceInput = useCallback(() => {
    const wasActive = voiceSessionActiveRef.current;
    voiceSessionActiveRef.current = false;
    setIsListening(false);
    if (wasActive && chatSpeechRecognitionModule) {
      try {
        chatSpeechRecognitionModule.abort();
      } catch {
        // Native recognition may already have ended between state updates.
      }
    }
  }, []);

  /** Show safe, platform-appropriate guidance for a recognizer failure. */
  const showVoiceError = useCallback((code: string) => {
    const guidance = chatVoiceError(code);
    if (!guidance) return;
    Alert.alert(
      guidance.title,
      guidance.message,
      guidance.canOpenSettings
        ? [
          { text: 'Not Now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => { void Linking.openSettings(); },
          },
        ]
        : [{ text: 'OK' }],
    );
  }, []);
  
  // Speech recognition event handlers
  useChatSpeechRecognitionEvent('start', () => {
    voiceSessionActiveRef.current = true;
    setIsListening(true);
  });
  
  useChatSpeechRecognitionEvent('end', () => {
    voiceSessionActiveRef.current = false;
    setIsListening(false);
  });
  
  useChatSpeechRecognitionEvent('result', (event) => {
    if (voiceSessionActiveRef.current && event.results && event.results.length > 0) {
      const transcript = event.results[0]?.transcript || '';
      if (transcript) {
        updateInputText(applyVoiceTranscript(voiceBaseTextRef.current, transcript));
      }
    }
  });
  
  useChatSpeechRecognitionEvent('error', (event) => {
    const wasActive = voiceSessionActiveRef.current;
    voiceSessionActiveRef.current = false;
    setIsListening(false);
    if (isVisible && (wasActive || event.error !== 'aborted')) showVoiceError(event.error);
  });
  
  /** Toggle editable speech dictation after verifying native availability and permission. */
  const handleMicPress = async () => {
    if (!isChatSpeechRecognitionAvailable || !chatSpeechRecognitionModule) {
      Alert.alert(
        'Voice Input Unavailable',
        'Voice input is not available in this version of the app.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      if (isListening) {
        chatSpeechRecognitionModule.stop();
        return;
      }
      if (
        typeof chatSpeechRecognitionModule.isRecognitionAvailable === 'function'
        && !chatSpeechRecognitionModule.isRecognitionAvailable()
      ) {
        showVoiceError('service-not-allowed');
        return;
      }
      const result = await chatSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        showVoiceError('not-allowed');
        return;
      }

      voiceBaseTextRef.current = inputTextRef.current;
      voiceSessionActiveRef.current = true;
      setIsListening(true);
      chatSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        maxAlternatives: 1,
        contextualStrings: [
          'ingredient',
          'tablespoon',
          'teaspoon',
          'temperature',
          ...(recipe?.extracted.title ? [recipe.extracted.title] : []),
        ],
      });
    } catch {
      voiceSessionActiveRef.current = false;
      setIsListening(false);
      showVoiceError('client');
    }
  };
  
  // Load only the active conversation. A late read from a prior recipe must
  // never replace a newly opened conversation or a message sent during load.
  useEffect(() => {
    const generation = historyLoadGenerationRef.current + 1;
    historyLoadGenerationRef.current = generation;
    const previousConversationKey = activeStorageKeyRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cancelVoiceInput();
    inFlightRef.current = false;
    setIsDelivering(false);
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    lastScrollAtRef.current = 0;
    if (previousConversationKey && loadedStorageKeyRef.current === previousConversationKey) {
      void writeChatDraft(previousConversationKey, inputTextRef.current).catch(() => undefined);
    }
    activeStorageKeyRef.current = null;
    loadedStorageKeyRef.current = null;
    setStorageKey(null);
    if (!isVisible) return;

    setIsLoadingHistory(true);
    setHistoryError(null);
    updateLoadedStorageKey(null);
    updateMessages([]);
    updateInputText('');
    setAttachedImage(null);
    setAttachedImageUri(null);
    void (async () => {
      try {
        const identity = await api.getCurrentUserIdentity();
        if (historyLoadGenerationRef.current !== generation) return;
        const conversationKey = chatStorageKey(identity.id, recipe?.id);
        activeStorageKeyRef.current = conversationKey;
        setStorageKey(conversationKey);
        // Unscoped history cannot be safely assigned to the account that happens
        // to open this release first, so remove it without reading or migrating it.
        try {
          await AsyncStorage.removeItem(legacyChatStorageKey(recipe?.id));
        } catch {
          // Never read the unsafe legacy key; a cleanup failure must not hide
          // this account's already-scoped conversation.
        }
        const stored = await AsyncStorage.getItem(conversationKey);
        let storedDraft: string | null = null;
        try {
          storedDraft = await readChatDraft(conversationKey);
        } catch {
          // Draft recovery is best-effort and must not block verified history.
        }
        if (
          historyLoadGenerationRef.current !== generation
          || activeStorageKeyRef.current !== conversationKey
        ) return;
        const history: ChatMessage[] = stored ? JSON.parse(stored) : [];
        updateMessages(normalizeStoredChatMessages(history));
        updateInputText((storedDraft ?? '').slice(0, CHAT_MESSAGE_MAX_CHARS));
        updateLoadedStorageKey(conversationKey);
        void recoverChatImageCleanup(conversationKey, stored !== null)
          .then(() => processChatImageCleanup(
            conversationKey,
            (urls) => api.deleteChatImages(urls),
          ))
          .catch(() => undefined);
      } catch {
        if (
          historyLoadGenerationRef.current !== generation
          || activeStorageKeyRef.current === null
        ) return;
        updateLoadedStorageKey(null);
        setHistoryError(
          'We could not load this conversation. Check your connection and reopen chat.',
        );
      } finally {
        if (historyLoadGenerationRef.current === generation) {
          if (activeStorageKeyRef.current === null) {
            setHistoryError('We could not verify this account. Check your connection and reopen chat.');
          }
          setIsLoadingHistory(false);
        }
      }
    })();
  }, [
    cancelVoiceInput,
    clerkUserId,
    isVisible,
    recipe?.id,
    updateInputText,
    updateLoadedStorageKey,
    updateMessages,
  ]);

  /** Debounce account-scoped text draft writes while the active history is usable. */
  useEffect(() => {
    if (!storageKey || loadedStorageKey !== storageKey) return undefined;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      void writeChatDraft(storageKey, inputText).catch(() => undefined);
    }, 300);
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [inputText, loadedStorageKey, storageKey]);

  /** Flush the latest loaded draft if the modal is removed without a visibility transition. */
  useEffect(() => () => {
    abortControllerRef.current?.abort();
    cancelVoiceInput();
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    const conversationKey = activeStorageKeyRef.current;
    if (conversationKey && loadedStorageKeyRef.current === conversationKey) {
      void writeChatDraft(conversationKey, inputTextRef.current).catch(() => undefined);
    }
  }, [cancelVoiceInput]);

  /** Persist UI state to its originating conversation key. */
  const saveChatHistory = useCallback(async (
    newMessages: ChatUiMessage[],
    conversationKey: string,
  ) => {
    try {
      await AsyncStorage.setItem(
        conversationKey,
        JSON.stringify(messagesForStorage(newMessages)),
      );
    } catch {
      // Non-critical: chat history won't persist, but conversation continues
    }
  }, []);

  /** Confirm and clear the current locally persisted conversation. */
  const handleClearChat = useCallback(() => {
    if (!storageKey || inFlightRef.current) return;
    const conversationKey = storageKey;
    Alert.alert(
      'Clear Chat',
      'Are you sure you want to clear this conversation? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            if (
              activeStorageKeyRef.current !== conversationKey
              || inFlightRef.current
              || clearInFlightRef.current
            ) return;
            const historySnapshot = messagesForStorage(messagesRef.current);
            const imageUrls = persistedChatImageUrls(historySnapshot);
            clearInFlightRef.current = true;
            setIsClearingChat(true);
            const cleanupJobId = createChatMessageId();
            try {
              if (imageUrls.length > 0) {
                await enqueueChatImageCleanup(conversationKey, {
                  id: cleanupJobId,
                  imageUrls,
                });
              }
            } catch {
              Alert.alert(
                'Could Not Clear Chat',
                'Your conversation is still here because this device could not save the cleanup request. Please try again.',
              );
              clearInFlightRef.current = false;
              setIsClearingChat(false);
              return;
            }

            try {
              await AsyncStorage.removeItem(conversationKey);
            } catch {
              if (imageUrls.length > 0) {
                await removeChatImageCleanup(conversationKey, cleanupJobId).catch(() => undefined);
              }
              Alert.alert(
                'Could Not Clear Chat',
                'Your conversation is still here because this device could not remove it. Please try again.',
              );
              clearInFlightRef.current = false;
              setIsClearingChat(false);
              return;
            }

            if (imageUrls.length > 0) {
              try {
                await activateChatImageCleanup(conversationKey, cleanupJobId);
              } catch {
                try {
                  await AsyncStorage.setItem(conversationKey, JSON.stringify(historySnapshot));
                  await removeChatImageCleanup(conversationKey, cleanupJobId).catch(() => undefined);
                  Alert.alert(
                    'Could Not Clear Chat',
                    'Your conversation was restored because its photo cleanup could not be prepared. Please try again.',
                  );
                } catch {
                  if (activeStorageKeyRef.current === conversationKey) {
                    updateLoadedStorageKey(null);
                    setHistoryError(
                      'Chat cleanup was interrupted. Reopen chat to recover it safely.',
                    );
                  }
                  Alert.alert(
                    'Chat Cleanup Paused',
                    'Reopen chat to finish cleanup safely. Your photos have not been deleted.',
                  );
                }
                clearInFlightRef.current = false;
                setIsClearingChat(false);
                return;
              }
            }

            if (activeStorageKeyRef.current === conversationKey) {
              updateMessages([]);
              updateInputText('');
              retryImagesRef.current.clear();
            }
            void writeChatDraft(conversationKey, '').catch(() => undefined);
            clearInFlightRef.current = false;
            setIsClearingChat(false);

            if (imageUrls.length > 0) {
              void processChatImageCleanup(
                conversationKey,
                (urls) => api.deleteChatImages(urls),
              ).then(() => hasChatImageCleanup(conversationKey, cleanupJobId))
              .then((pending) => {
                if (!pending) return;
                Alert.alert(
                  'Chat Cleared',
                  'The conversation was cleared. We will keep retrying its photo cleanup automatically.',
                );
              }).catch(() => undefined);
            }
          },
        },
      ]
    );
  }, [storageKey, updateInputText, updateLoadedStorageKey, updateMessages]);

  // Throttle with a trailing scroll so continuous stream deltas remain visible.
  useEffect(() => {
    if (messages.length === 0 || scrollTimerRef.current) return;
    const elapsed = Date.now() - lastScrollAtRef.current;
    const delay = Math.max(0, 250 - elapsed);
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      lastScrollAtRef.current = Date.now();
      if (typeof scrollViewRef.current?.scrollToEnd === 'function') {
        scrollViewRef.current.scrollToEnd({ animated: true });
      }
    }, delay);
  }, [messages]);

  /** Apply one validated attachment consistently across camera, library, and paste. */
  const applyImageAttachment = useCallback((encoded: string, previewUri?: string) => {
    try {
      const attachment = normalizeChatImageAttachment(encoded, previewUri);
      setAttachedImage(attachment.base64);
      setAttachedImageUri(attachment.uri);
    } catch (error) {
      Alert.alert(
        'Could Not Attach Photo',
        error instanceof Error ? error.message : 'That photo could not be attached.',
      );
    }
  }, []);

  /** Merge a text paste into the draft or attach a pasted image. */
  const handleNativePaste = useCallback((payload: Clipboard.PasteEventPayload) => {
    try {
      const pasted = normalizeChatPaste(payload);
      if (pasted.type === 'image') {
        applyImageAttachment(pasted.base64, pasted.uri);
        return;
      }
      const result = appendPastedChatText(inputTextRef.current, pasted.text);
      updateInputText(result.text);
      if (result.truncated) {
        Alert.alert('Paste Shortened', 'The pasted text was shortened to the 4,000-character chat limit.');
      }
    } catch (error) {
      Alert.alert(
        'Could Not Paste',
        error instanceof Error ? error.message : 'The clipboard content could not be pasted.',
      );
    }
  }, [applyImageAttachment, updateInputText]);

  /** Paste from platforms without Apple's native, permissionless paste control. */
  const handleFallbackPaste = useCallback(async () => {
    try {
      if (await Clipboard.hasImageAsync()) {
        const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.75 });
        if (image) {
          handleNativePaste({ ...image, type: 'image' });
          return;
        }
      }
      const text = await Clipboard.getStringAsync();
      if (text) {
        handleNativePaste({ type: 'text', text });
        return;
      }
      Alert.alert('Nothing to Paste', 'Copy text or an image, then try again.');
    } catch {
      Alert.alert('Could Not Paste', 'Clipboard access was unavailable. Please try again.');
    }
  }, [handleNativePaste]);

  /** Attach one compressed image selected from the photo library. */
  const handlePickImage = async () => {
    const conversationKey = activeStorageKeyRef.current;
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (activeStorageKeyRef.current !== conversationKey) return;
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photos to attach images.');
        return;
      }

      // Launch image picker - no cropping, full image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.7,
        base64: true,
      });
      if (activeStorageKeyRef.current !== conversationKey) return;

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.base64) {
          applyImageAttachment(asset.base64, asset.uri);
        } else {
          Alert.alert('Could Not Attach Photo', 'The selected photo could not be read.');
        }
      }
    } catch (error) {
      console.log('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  /** Attach one compressed image captured by the camera. */
  const handleTakePhoto = async () => {
    const conversationKey = activeStorageKeyRef.current;
    try {
      // Request camera permission
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (activeStorageKeyRef.current !== conversationKey) return;
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your camera to take photos.');
        return;
      }

      // Launch camera - no cropping, full image
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.7,
        base64: true,
      });
      if (activeStorageKeyRef.current !== conversationKey) return;

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.base64) {
          applyImageAttachment(asset.base64, asset.uri);
        } else {
          Alert.alert('Could Not Attach Photo', 'The captured photo could not be read.');
        }
      }
    } catch (error) {
      console.log('Camera error:', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  /** Remove the pending image without changing the text draft. */
  const handleRemoveImage = () => {
    setAttachedImage(null);
    setAttachedImageUri(null);
  };

  /** Deliver one message and commit its success or failure without stale snapshots. */
  const sendMessage = async (userMessage: ChatUiMessage, imageToSend?: string) => {
    if (inFlightRef.current) return;
    const abortController = new AbortController();
    const assistantMessageId = createChatMessageId();
    abortControllerRef.current = abortController;
    inFlightRef.current = true;
    setIsDelivering(true);
    const conversationKey = activeStorageKeyRef.current;
    if (!conversationKey) {
      abortControllerRef.current = null;
      inFlightRef.current = false;
      setIsDelivering(false);
      return;
    }
    const sendingMessage: ChatUiMessage = {
      ...userMessage,
      status: 'sending',
      error_message: undefined,
    };
    const deliveryStart = beginMessageDelivery(messagesRef.current, sendingMessage);
    const previousMessages = deliveryStart.contextMessages;
    let sendingMessages = deliveryStart.displayMessages;
    updateMessages(sendingMessages);
    await saveChatHistory(sendingMessages, conversationKey);

    try {
      let s3ImageUrl = sendingMessage.image_url?.startsWith('https://')
        ? sendingMessage.image_url
        : undefined;
      if (imageToSend && !s3ImageUrl) {
        try {
          const uploadResult = await api.uploadChatImage(imageToSend, abortController.signal);
          s3ImageUrl = uploadResult.image_url;
          const currentMessages = activeStorageKeyRef.current === conversationKey
            ? messagesRef.current
            : sendingMessages;
          sendingMessages = currentMessages.map((message) => message.id === sendingMessage.id
            ? { ...message, image_url: s3ImageUrl }
            : message);
          if (activeStorageKeyRef.current === conversationKey) updateMessages(sendingMessages);
          await saveChatHistory(sendingMessages, conversationKey);
        } catch (error) {
          if (abortController.signal.aborted) throw error;
          console.log('Failed to upload image to S3, continuing without persistent URL');
        }
      }

      const defaultImageMessage = isGeneralMode
        ? 'What do you see in this image?'
        : 'What do you see in this image? How does it relate to this recipe?';
      const requestContent = sendingMessage.request_content || sendingMessage.content;
      // The user bubble is the current request.message. For a retry, history
      // intentionally contains only complete turns that preceded that bubble.
      const historyForApi = selectChatContext(previousMessages);
      const onDelta = (_delta: string, responseText: string) => {
        const currentMessages = activeStorageKeyRef.current === conversationKey
          ? messagesRef.current
          : sendingMessages;
        const partialMessages = upsertStreamingResponse(
          currentMessages,
          sendingMessage.id,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: responseText,
            status: 'sending',
          },
          s3ImageUrl,
        );
        sendingMessages = partialMessages;
        if (activeStorageKeyRef.current === conversationKey) updateMessages(partialMessages);
      };
      const response = isGeneralMode
        ? await cookingChatMutation.mutateAsync({
            message: requestContent || defaultImageMessage,
            history: historyForApi,
            imageBase64: imageToSend,
            onDelta,
            signal: abortController.signal,
          })
        : await recipeChatMutation.mutateAsync({
            recipeId: recipe!.id,
            message: requestContent || defaultImageMessage,
            history: historyForApi,
            imageBase64: imageToSend,
            onDelta,
            signal: abortController.signal,
          });

      const assistantMessage: ChatUiMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: response.response,
        status: 'sent',
      };
      const currentMessages = activeStorageKeyRef.current === conversationKey
        ? messagesRef.current
        : sendingMessages;
      const finalMessages = completeMessageDelivery(
        currentMessages,
        sendingMessage.id,
        assistantMessage,
        s3ImageUrl,
      );
      if (activeStorageKeyRef.current === conversationKey) updateMessages(finalMessages);
      retryImagesRef.current.delete(sendingMessage.id);
      await saveChatHistory(finalMessages, conversationKey);
    } catch (error) {
      const cancelled = isChatAbortError(error, abortController.signal);
      const currentMessages = activeStorageKeyRef.current === conversationKey
        ? messagesRef.current
        : sendingMessages;
      const interruptedMessages = interruptMessageDelivery(
        currentMessages,
        sendingMessage.id,
        assistantMessageId,
        cancelled ? 'cancelled' : 'failed',
        cancelled ? 'Response stopped.' : chatErrorMessage(error),
      );
      if (activeStorageKeyRef.current === conversationKey) updateMessages(interruptedMessages);
      await saveChatHistory(interruptedMessages, conversationKey);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        inFlightRef.current = false;
        setIsDelivering(false);
      }
    }
  };

  /** Convert the active draft or suggestion into a single optimistic user message. */
  const handleSend = async (text?: string) => {
    if (inFlightRef.current || clearInFlightRef.current || isComposerUnavailable) return;
    cancelVoiceInput();
    const messageText = text || inputText.trim();
    if (!messageText && !attachedImage) return;

    const imageToSend = attachedImage || undefined;
    const messageId = createChatMessageId();
    const userMessage: ChatUiMessage = {
      id: messageId,
      role: 'user',
      content: imageToSend
        ? (messageText ? `Photo: ${messageText}` : '[Photo attached]')
        : messageText,
      request_content: messageText,
      image_url: attachedImageUri || undefined,
      has_image: !!imageToSend,
      status: 'sending',
    };
    if (imageToSend) retryImagesRef.current.set(messageId, imageToSend);

    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    updateInputText('');
    const conversationKey = activeStorageKeyRef.current;
    if (conversationKey) {
      void writeChatDraft(conversationKey, '').catch(() => undefined);
    }
    setAttachedImage(null);
    setAttachedImageUri(null);
    Keyboard.dismiss();
    await sendMessage(userMessage, imageToSend);
  };

  /** Retry a failed bubble while preserving its identity and required image data. */
  const handleRetry = async (message: ChatUiMessage) => {
    const retryImage = retryImagesRef.current.get(message.id) || attachedImage || undefined;
    if (message.has_image && !retryImage) {
      Alert.alert('Reattach photo', 'Please attach the photo again before retrying this message.');
      return;
    }
    if (retryImage) {
      retryImagesRef.current.set(message.id, retryImage);
      setAttachedImage(null);
      setAttachedImageUri(null);
    }
    await sendMessage(message, retryImage);
  };

  /** Send a quick suggestion through the same guarded delivery path. */
  const handleSuggestionPress = (suggestion: string) => {
    handleSend(suggestion);
  };

  /** Stop the active network response while keeping the user message retryable. */
  const handleStopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  /** Cancel transient work before dismissing the modal. */
  const handleClose = useCallback(() => {
    abortControllerRef.current?.abort();
    cancelVoiceInput();
    void stop();
    onClose();
  }, [cancelVoiceInput, onClose, stop]);

  /** Copy message text and briefly show success feedback on that bubble. */
  const handleCopyMessage = async (text: string, messageId: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedId(messageId);
      // Reset after 2 seconds
      setTimeout(() => {
        setCopiedId(null);
      }, 2000);
    } catch {
      Alert.alert('Error', 'Failed to copy message');
    }
  };

  /** Toggle text-to-speech playback for one assistant response. */
  const handleSpeakPress = async (text: string, messageId: string) => {
    if (speakingId === messageId && isPlaying) {
      // Stop if already playing this message
      await stop();
      setSpeakingId(null);
    } else {
      // Stop any current playback and start new
      await stop();
      setSpeakingId(messageId);
      await speak(text);
    }
  };

  // Reset speaking index when playback stops
  useEffect(() => {
    if (!isPlaying && !ttsLoading) {
      setSpeakingId(null);
    }
  }, [isPlaying, ttsLoading]);

  useEffect(() => {
    if (!ttsError) return;
    Alert.alert('Could Not Read Response', ttsError, [{ text: 'OK' }]);
    clearTTSError();
  }, [clearTTSError, ttsError]);

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={isVisible}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        {/* Header */}
        <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
          <RNView style={styles.headerContent}>
            <Ionicons name={isGeneralMode ? "restaurant" : "chatbubbles"} size={24} color={colors.tint} />
            <RNView style={styles.headerTextContainer}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                {isGeneralMode ? "Cooking Assistant" : "Recipe Assistant"}
              </Text>
              {!isGeneralMode && recipe && (
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {recipe.extracted.title}
                </Text>
              )}
              {isGeneralMode && (
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  Ask me anything about cooking!
                </Text>
              )}
            </RNView>
          </RNView>
          <RNView style={styles.headerButtons}>
            {messages.length > 0 && (
              <TouchableOpacity
                onPress={handleClearChat}
                disabled={isClearingChat || isDelivering}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="Clear conversation"
                accessibilityState={{
                  disabled: isClearingChat || isDelivering,
                  busy: isClearingChat,
                }}
              >
                <Ionicons name="trash-outline" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleClose}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel="Close chat"
            >
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
          </RNView>
        </RNView>

        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Loading history */}
          {isLoadingHistory && (
            <RNView style={styles.welcomeContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
              <Text style={[styles.loadingHistoryText, { color: colors.textSecondary }]}>
                Loading conversation...
              </Text>
            </RNView>
          )}

          {!isLoadingHistory && historyError && (
            <RNView style={[styles.historyError, { backgroundColor: colors.backgroundSecondary }]}>
              <Ionicons name="cloud-offline-outline" size={22} color={colors.error} />
              <Text style={[styles.historyErrorText, { color: colors.textSecondary }]}>
                {historyError}
              </Text>
            </RNView>
          )}

          {/* Welcome message */}
          {!isLoadingHistory && !historyError && messages.length === 0 && (
            <RNView style={styles.welcomeContainer}>
              <Ionicons name="sparkles" size={48} color={colors.tint} />
              <Text style={[styles.welcomeTitle, { color: colors.text }]}>
                {isGeneralMode 
                  ? "Your personal cooking assistant!" 
                  : "Ask me anything about this recipe!"}
              </Text>
              <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>
                {isGeneralMode
                  ? "I can help with recipe ideas, cooking tips, food safety, ingredient substitutions, and more."
                  : "I can help with substitutions, scaling, cooking tips, dietary modifications, and more."}
              </Text>
              <Text style={[styles.photoPrivacyNotice, { color: colors.textMuted }]}>
                Photos are sent to our AI provider and stored with this chat. Don&apos;t upload sensitive personal information.
              </Text>
            </RNView>
          )}

          {/* Quick suggestions */}
          {!isLoadingHistory && !historyError && messages.length === 0 && (
            <RNView style={styles.suggestionsContainer}>
              <Text style={[styles.suggestionsTitle, { color: colors.textMuted }]}>
                Try asking:
              </Text>
              <RNView style={styles.suggestionsWrap}>
                {quickSuggestions.map((suggestion) => (
                  <TouchableOpacity
                    key={suggestion}
                    style={[styles.suggestionChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleSuggestionPress(suggestion)}
                    accessibilityRole="button"
                    accessibilityLabel={suggestion}
                  >
                    <Text style={[styles.suggestionText, { color: colors.tint }]}>
                      {suggestion}
                    </Text>
                  </TouchableOpacity>
                ))}
              </RNView>
            </RNView>
          )}

          {/* Previous conversation indicator */}
          {!isLoadingHistory && messages.length > 0 && (
            <RNView style={[styles.previousConvoIndicator, { backgroundColor: colors.backgroundSecondary }]}>
              <Ionicons name="time-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.previousConvoText, { color: colors.textMuted }]}>
                Previous conversation
              </Text>
            </RNView>
          )}

          {/* Chat messages */}
          {messages.map((msg) => (
            <RNView
              key={msg.id}
              style={[
                styles.messageWrapper,
                msg.role === 'user' ? styles.userWrapper : styles.assistantWrapper,
              ]}
            >
              {/* Message Bubble */}
              <RNView
                style={[
                  styles.messageBubble,
                  msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  {
                    backgroundColor: msg.role === 'user' ? colors.tint : colors.card,
                    borderColor: msg.role === 'user' ? colors.tint : colors.border,
                  },
                ]}
              >
                {msg.role === 'user' ? (
                  <>
                    {msg.image_url && (
                      <RNView style={styles.messageImageContainer}>
                        <Image 
                          source={{ uri: msg.image_url }} 
                          style={styles.messageImage}
                          resizeMode="cover"
                          accessible
                          accessibilityLabel="Attached chat photo"
                          onError={() => {
                            // Image failed to load (stale URI) - will show placeholder
                          }}
                        />
                      </RNView>
                    )}
                    <Text style={[styles.messageText, { color: '#FFFFFF' }]}>
                      {msg.content}
                    </Text>
                  </>
                ) : (
                  <Markdown
                    rules={CHAT_MARKDOWN_RULES}
                    onLinkPress={handleAssistantLink}
                    style={{
                      body: { color: colors.text, fontSize: fontSize.md, lineHeight: 24, flexShrink: 1 },
                      paragraph: { marginVertical: 4, flexShrink: 1 },
                      strong: { fontWeight: '700', color: colors.text },
                      em: { fontStyle: 'italic' },
                      bullet_list: { marginVertical: 4 },
                      ordered_list: { marginVertical: 4 },
                      list_item: { marginVertical: 2, flexShrink: 1, flexWrap: 'wrap' },
                      bullet_list_icon: { color: colors.tint, fontSize: 8, marginRight: 8 },
                      ordered_list_icon: { color: colors.tint, fontWeight: '600', marginRight: 8 },
                      bullet_list_content: { flexShrink: 1 },
                      ordered_list_content: { flexShrink: 1 },
                      heading1: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text, marginVertical: 8 },
                      heading2: { fontSize: fontSize.lg, fontWeight: '600', color: colors.text, marginVertical: 6 },
                      heading3: { fontSize: fontSize.md, fontWeight: '600', color: colors.text, marginVertical: 4 },
                      code_inline: { backgroundColor: colors.backgroundSecondary, paddingHorizontal: 4, borderRadius: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
                      fence: { backgroundColor: colors.backgroundSecondary, padding: 8, borderRadius: 8, marginVertical: 4 },
                      link: { color: colors.tint },
                    }}
                  >
                    {msg.content}
                  </Markdown>
                )}
              </RNView>

              {/* Action Bar - Below Bubble */}
              <RNView 
                style={[
                  styles.actionBar,
                  msg.role === 'user' ? styles.actionBarRight : styles.actionBarLeft,
                ]}
              >
                {msg.role === 'user' && msg.status === 'sending' && (
                  <RNView style={styles.deliveryState}>
                    <ActivityIndicator size={12} color={colors.textMuted} />
                    <Text style={[styles.deliveryStateText, { color: colors.textMuted }]}>Sending…</Text>
                  </RNView>
                )}
                {msg.role === 'user' && (msg.status === 'failed' || msg.status === 'cancelled') && (
                  <RNView style={styles.deliveryState}>
                    <Ionicons
                      name={msg.status === 'cancelled' ? 'stop-circle-outline' : 'alert-circle-outline'}
                      size={14}
                      color={colors.error}
                    />
                    <Text style={[styles.deliveryErrorText, { color: colors.error }]}>
                      {msg.error_message || (msg.status === 'cancelled'
                        ? 'Response stopped.'
                        : 'Your message was not sent.')}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleRetry(msg)}
                      disabled={isComposerUnavailable}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.retryButton}
                      accessibilityRole="button"
                      accessibilityLabel="Retry message"
                      accessibilityState={{ disabled: isComposerUnavailable }}
                    >
                      <Text style={[styles.retryText, { color: colors.tint }]}>Retry</Text>
                    </TouchableOpacity>
                  </RNView>
                )}
                {/* Copy button */}
                {msg.status !== 'sending' && (
                  <TouchableOpacity
                    onPress={() => handleCopyMessage(msg.content, msg.id)}
                    style={styles.actionBarButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Copy message"
                  >
                    <Ionicons
                      name={copiedId === msg.id ? "checkmark" : "copy-outline"}
                      size={14}
                      color={copiedId === msg.id ? colors.tint : colors.textMuted}
                    />
                  </TouchableOpacity>
                )}

                {/* Speak button - only for assistant */}
                {msg.role === 'assistant' && msg.status !== 'sending' && (
                  <TouchableOpacity
                    onPress={() => handleSpeakPress(msg.content, msg.id)}
                    disabled={ttsLoading && speakingId === msg.id}
                    style={styles.actionBarButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={speakingId === msg.id && isPlaying
                      ? 'Stop reading response'
                      : 'Read response aloud'}
                    accessibilityState={{ disabled: ttsLoading && speakingId === msg.id }}
                  >
                    {ttsLoading && speakingId === msg.id ? (
                      <ActivityIndicator size={12} color={colors.tint} />
                    ) : (
                      <Ionicons
                        name={speakingId === msg.id && isPlaying ? 'stop' : 'volume-high'}
                        size={14}
                        color={speakingId === msg.id && isPlaying ? colors.error : colors.textMuted}
                      />
                    )}
                  </TouchableOpacity>
                )}
              </RNView>
            </RNView>
          ))}

          {/* Loading indicator */}
          {isDelivering && !hasStreamingResponse && (
            <RNView style={[styles.loadingContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ActivityIndicator size="small" color={colors.tint} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Thinking...
              </Text>
            </RNView>
          )}
        </ScrollView>

        <ChatComposer
          conversationKey={storageKey}
          text={inputText}
          attachedImageUri={attachedImageUri}
          isListening={isListening}
          isSending={isDelivering}
          isUnavailable={isComposerUnavailable}
          isGeneralMode={isGeneralMode}
          onChangeText={updateInputText}
          onSend={() => { void handleSend(); }}
          onCancel={handleStopGenerating}
          onTakePhoto={() => { void handleTakePhoto(); }}
          onPickImage={() => { void handlePickImage(); }}
          onRemoveImage={handleRemoveImage}
          onMicPress={() => { void handleMicPress(); }}
          onNativePaste={handleNativePaste}
          onFallbackPaste={() => { void handleFallbackPaste(); }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerButton: {
    padding: spacing.xs,
  },
  loadingHistoryText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
  },
  historyError: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    margin: spacing.lg,
    padding: spacing.md,
  },
  historyErrorText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  previousConvoIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  previousConvoText: {
    fontSize: fontSize.xs,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  welcomeContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  welcomeTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  welcomeSubtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  photoPrivacyNotice: {
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginTop: spacing.md,
    maxWidth: 320,
    textAlign: 'center',
  },
  suggestionsContainer: {
    marginTop: spacing.lg,
  },
  suggestionsTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.sm,
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  suggestionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  suggestionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  messageWrapper: {
    marginBottom: spacing.md,
    maxWidth: '88%',
  },
  userWrapper: {
    alignSelf: 'flex-end',
  },
  assistantWrapper: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  userBubble: {
    borderBottomRightRadius: radius.xs,
  },
  assistantBubble: {
    borderBottomLeftRadius: radius.xs,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  actionBarLeft: {
    justifyContent: 'flex-start',
    paddingLeft: spacing.xs,
  },
  actionBarRight: {
    justifyContent: 'flex-end',
    paddingRight: spacing.xs,
  },
  actionBarButton: {
    padding: spacing.xs,
    opacity: 0.6,
  },
  deliveryState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  deliveryStateText: {
    fontSize: fontSize.xs,
  },
  deliveryErrorText: {
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  retryText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  retryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  messageText: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: fontSize.sm,
  },
  messageImageContainer: {
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  messageImage: {
    width: '100%',
    height: 150,
    borderRadius: radius.md,
  },
});

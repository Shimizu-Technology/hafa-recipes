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
  TextInput,
  Image,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';

// Speech recognition - conditionally import to avoid crashes in Expo Go
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: any = () => {}; // no-op hook
let speechRecognitionAvailable = false;

try {
  const speechModule = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = speechModule.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = speechModule.useSpeechRecognitionEvent;
  speechRecognitionAvailable = !!ExpoSpeechRecognitionModule;
} catch {
  // Speech recognition not available (Expo Go or module not linked)
  console.log('Speech recognition not available - requires development build');
}

import { View, Text, useColors } from '@/components/Themed';
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
  messagesForStorage,
  normalizeStoredChatMessages,
  selectChatContext,
} from '../lib/chatContext';
import { chatErrorMessage } from '../lib/chatErrors';

// Storage key prefix for chat history
const CHAT_STORAGE_KEY_PREFIX = 'recipe_chat_';
const COOKING_CHAT_STORAGE_KEY = 'cooking_assistant_chat';
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

export default function RecipeChatModal({ isVisible, onClose, recipe }: RecipeChatModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Determine mode: recipe-specific or general cooking
  const isGeneralMode = !recipe;
  const quickSuggestions = isGeneralMode ? COOKING_SUGGESTIONS : RECIPE_SUGGESTIONS;
  const storageKey = isGeneralMode
    ? COOKING_CHAT_STORAGE_KEY
    : `${CHAT_STORAGE_KEY_PREFIX}${recipe?.id}`;
  
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const messagesRef = useRef<ChatUiMessage[]>([]);
  const retryImagesRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef(false);
  const activeStorageKeyRef = useRef(storageKey);
  const historyLoadGenerationRef = useRef(0);
  const [inputText, setInputText] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [isDelivering, setIsDelivering] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);  // Base64 image
  const [attachedImageUri, setAttachedImageUri] = useState<string | null>(null);  // For preview
  const isComposerUnavailable = isDelivering
    || isLoadingHistory
    || loadedStorageKey !== storageKey;
  
  // Use appropriate mutation hook based on mode
  const recipeChatMutation = useChatWithRecipe();
  const cookingChatMutation = useCookingChat();
  
  const { speak, stop, isPlaying, isLoading: ttsLoading } = useTTS();

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
  
  // Speech recognition event handlers
  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
  });
  
  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });
  
  useSpeechRecognitionEvent('result', (event: any) => {
    // Get the best result from the transcription
    if (event.results && event.results.length > 0) {
      const transcript = event.results[0]?.transcript || '';
      if (transcript) {
        setInputText(prev => prev + (prev ? ' ' : '') + transcript);
      }
    }
  });
  
  useSpeechRecognitionEvent('error', (event: any) => {
    console.log('Speech recognition error:', event.error);
    setIsListening(false);
    if (event.error === 'not-allowed') {
      Alert.alert(
        'Microphone Permission Required',
        'Please enable microphone access in Settings to use voice input.',
        [{ text: 'OK' }]
      );
    }
  });
  
  /** Toggle editable speech dictation after verifying native availability and permission. */
  const handleMicPress = async () => {
    if (!speechRecognitionAvailable || !ExpoSpeechRecognitionModule) {
      Alert.alert(
        'Not Available',
        'Voice input requires a development build. It is not available in Expo Go.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    if (isListening) {
      // Stop listening
      await ExpoSpeechRecognitionModule.stop();
    } else {
      // Request permission and start listening
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert(
          'Permission Required',
          'Microphone and speech recognition permissions are needed for voice input.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Start speech recognition
      await ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        maxAlternatives: 1,
      });
    }
  };
  
  // Load only the active conversation. A late read from a prior recipe must
  // never replace a newly opened conversation or a message sent during load.
  useEffect(() => {
    activeStorageKeyRef.current = storageKey;
    const generation = historyLoadGenerationRef.current + 1;
    historyLoadGenerationRef.current = generation;
    if (!isVisible) return;

    setIsLoadingHistory(true);
    setLoadedStorageKey(null);
    updateMessages([]);
    setInputText('');
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        if (
          historyLoadGenerationRef.current !== generation
          || activeStorageKeyRef.current !== storageKey
        ) return;
        const history: ChatMessage[] = stored ? JSON.parse(stored) : [];
        updateMessages(normalizeStoredChatMessages(history));
        setLoadedStorageKey(storageKey);
      } catch {
        if (
          historyLoadGenerationRef.current !== generation
          || activeStorageKeyRef.current !== storageKey
        ) return;
        updateMessages([]);
        setLoadedStorageKey(storageKey);
      } finally {
        if (
          historyLoadGenerationRef.current === generation
          && activeStorageKeyRef.current === storageKey
        ) setIsLoadingHistory(false);
      }
    })();
  }, [isVisible, storageKey, updateMessages]);

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
    Alert.alert(
      'Clear Chat',
      'Are you sure you want to clear this conversation? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            updateMessages([]);
            retryImagesRef.current.clear();
            try {
              await AsyncStorage.removeItem(storageKey);
            } catch {
              // Non-critical: stale history will be overwritten on next save
            }
          },
        },
      ]
    );
  }, [storageKey, updateMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  /** Attach one compressed image selected from the photo library. */
  const handlePickImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
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

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.base64) {
          setAttachedImage(asset.base64);
          setAttachedImageUri(asset.uri);
        }
      }
    } catch (error) {
      console.log('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  /** Attach one compressed image captured by the camera. */
  const handleTakePhoto = async () => {
    try {
      // Request camera permission
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
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

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.base64) {
          setAttachedImage(asset.base64);
          setAttachedImageUri(asset.uri);
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
    inFlightRef.current = true;
    setIsDelivering(true);
    const conversationKey = activeStorageKeyRef.current;
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
          const uploadResult = await api.uploadChatImage(imageToSend);
          s3ImageUrl = uploadResult.image_url;
          const currentMessages = activeStorageKeyRef.current === conversationKey
            ? messagesRef.current
            : sendingMessages;
          sendingMessages = currentMessages.map((message) => message.id === sendingMessage.id
            ? { ...message, image_url: s3ImageUrl }
            : message);
          if (activeStorageKeyRef.current === conversationKey) updateMessages(sendingMessages);
          await saveChatHistory(sendingMessages, conversationKey);
        } catch {
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
      const response = isGeneralMode
        ? await cookingChatMutation.mutateAsync({
            message: requestContent || defaultImageMessage,
            history: historyForApi,
            imageBase64: imageToSend,
          })
        : await recipeChatMutation.mutateAsync({
            recipeId: recipe!.id,
            message: requestContent || defaultImageMessage,
            history: historyForApi,
            imageBase64: imageToSend,
          });

      const assistantMessage: ChatUiMessage = {
        id: createChatMessageId(),
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
      const currentMessages = activeStorageKeyRef.current === conversationKey
        ? messagesRef.current
        : sendingMessages;
      const failedMessages = currentMessages.map((message) => message.id === sendingMessage.id
        ? { ...message, status: 'failed' as const, error_message: chatErrorMessage(error) }
        : message);
      if (activeStorageKeyRef.current === conversationKey) updateMessages(failedMessages);
      await saveChatHistory(failedMessages, conversationKey);
    } finally {
      inFlightRef.current = false;
      setIsDelivering(false);
    }
  };

  /** Convert the active draft or suggestion into a single optimistic user message. */
  const handleSend = async (text?: string) => {
    if (inFlightRef.current || isComposerUnavailable) return;
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

    setInputText('');
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

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={isVisible}
      onRequestClose={onClose}
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
              <TouchableOpacity onPress={handleClearChat} style={styles.headerButton}>
                <Ionicons name="trash-outline" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} style={styles.headerButton}>
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

          {/* Welcome message */}
          {!isLoadingHistory && messages.length === 0 && (
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
            </RNView>
          )}

          {/* Quick suggestions */}
          {!isLoadingHistory && messages.length === 0 && (
            <RNView style={styles.suggestionsContainer}>
              <Text style={[styles.suggestionsTitle, { color: colors.textMuted }]}>
                Try asking:
              </Text>
              <RNView style={styles.suggestionsWrap}>
                {quickSuggestions.map((suggestion, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[styles.suggestionChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleSuggestionPress(suggestion)}
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
                {msg.role === 'user' && msg.status === 'failed' && (
                  <RNView style={styles.deliveryState}>
                    <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
                    <Text style={[styles.deliveryErrorText, { color: colors.error }]}>
                      {msg.error_message || 'Your message was not sent.'}
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
                <TouchableOpacity
                  onPress={() => handleCopyMessage(msg.content, msg.id)}
                  style={styles.actionBarButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={copiedId === msg.id ? "checkmark" : "copy-outline"}
                    size={14}
                    color={copiedId === msg.id ? colors.tint : colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Speak button - only for assistant */}
                {msg.role === 'assistant' && (
                  <TouchableOpacity
                    onPress={() => handleSpeakPress(msg.content, msg.id)}
                    disabled={ttsLoading && speakingId === msg.id}
                    style={styles.actionBarButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
          {isDelivering && (
            <RNView style={[styles.loadingContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ActivityIndicator size="small" color={colors.tint} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Thinking...
              </Text>
            </RNView>
          )}
        </ScrollView>

        {/* Attached Image Preview */}
        {attachedImageUri && (
          <RNView style={[styles.attachedImageContainer, { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.border }]}>
            <Image source={{ uri: attachedImageUri }} style={styles.attachedImagePreview} />
            <TouchableOpacity 
              style={[styles.removeImageButton, { backgroundColor: colors.error }]} 
              onPress={handleRemoveImage}
            >
              <Ionicons name="close" size={16} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={[styles.attachedImageHint, { color: colors.textMuted }]}>
              Photo attached - add a message or send
            </Text>
          </RNView>
        )}

        {/* Input area */}
        <RNView
          style={[
            styles.inputContainer,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + spacing.sm,
              paddingTop: spacing.md,
            },
          ]}
        >
          {/* Camera button */}
          <TouchableOpacity
            onPress={handleTakePhoto}
            disabled={isComposerUnavailable}
            style={[
              styles.imageButton,
              { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
            ]}
          >
            <Ionicons name="camera-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Photo library button */}
          <TouchableOpacity
            onPress={handlePickImage}
            disabled={isComposerUnavailable}
            style={[
              styles.imageButton,
              { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
            ]}
          >
            <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Microphone button */}
          <TouchableOpacity
            onPress={handleMicPress}
            disabled={isComposerUnavailable}
            style={[
              styles.micButton,
              {
                backgroundColor: isListening ? colors.error : colors.backgroundSecondary,
                borderColor: isListening ? colors.error : colors.border,
              },
            ]}
          >
            <Ionicons
              name={isListening ? 'mic' : 'mic-outline'}
              size={20}
              color={isListening ? '#FFFFFF' : colors.textSecondary}
            />
          </TouchableOpacity>
          
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder={attachedImage ? 'Add a message (optional)...' : (isListening ? 'Listening...' : (isGeneralMode ? 'Ask anything about cooking...' : 'Ask about this recipe...'))}
            placeholderTextColor={isListening ? colors.error : colors.textMuted}
            multiline
            maxLength={500}
            editable={!isComposerUnavailable}
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: isListening ? colors.error : colors.border,
                color: colors.text,
              },
            ]}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => handleSend()}
          />
          <TouchableOpacity
            onPress={() => handleSend()}
            disabled={
              (!inputText.trim() && !attachedImage)
              || isComposerUnavailable
            }
            style={[
              styles.sendButton,
              {
                backgroundColor: (inputText.trim() || attachedImage) ? colors.tint : colors.border,
              },
            ]}
          >
            <Ionicons
              name="send"
              size={20}
              color={(inputText.trim() || attachedImage) ? '#FFFFFF' : colors.textMuted}
            />
          </TouchableOpacity>
        </RNView>
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    height: 44,
    maxHeight: 100,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    fontSize: fontSize.md,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  imageButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  attachedImageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  attachedImagePreview: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
  },
  removeImageButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: spacing.xs,
    left: spacing.sm + 48,
  },
  attachedImageHint: {
    fontSize: fontSize.xs,
    flex: 1,
    marginLeft: spacing.sm,
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

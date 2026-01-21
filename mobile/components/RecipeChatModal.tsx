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
import Markdown from 'react-native-markdown-display';
import api from '@/lib/api';

// Storage key prefix for chat history
const CHAT_STORAGE_KEY_PREFIX = 'recipe_chat_';
const COOKING_CHAT_STORAGE_KEY = 'cooking_assistant_chat';

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
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);  // Track which message was just copied
  const [attachedImage, setAttachedImage] = useState<string | null>(null);  // Base64 image
  const [attachedImageUri, setAttachedImageUri] = useState<string | null>(null);  // For preview
  
  // Use appropriate mutation hook based on mode
  const recipeChatMutation = useChatWithRecipe();
  const cookingChatMutation = useCookingChat();
  const chatMutation = isGeneralMode ? cookingChatMutation : recipeChatMutation;
  
  const { speak, stop, isPlaying, isLoading: ttsLoading } = useTTS();
  
  // Speech recognition event handlers
  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
  });
  
  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });
  
  useSpeechRecognitionEvent('result', (event) => {
    // Get the best result from the transcription
    if (event.results && event.results.length > 0) {
      const transcript = event.results[0]?.transcript || '';
      if (transcript) {
        setInputText(prev => prev + (prev ? ' ' : '') + transcript);
      }
    }
  });
  
  useSpeechRecognitionEvent('error', (event) => {
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
  
  // Storage key differs based on mode
  const storageKey = isGeneralMode 
    ? COOKING_CHAT_STORAGE_KEY 
    : `${CHAT_STORAGE_KEY_PREFIX}${recipe?.id}`;

  // Load chat history from AsyncStorage when modal opens
  useEffect(() => {
    if (isVisible) {
      loadChatHistory();
      setInputText('');
    }
  }, [isVisible, recipe?.id, isGeneralMode]);

  const loadChatHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const stored = await AsyncStorage.getItem(storageKey);
      if (stored) {
        const history: ChatMessage[] = JSON.parse(stored);
        setMessages(history);
      } else {
        setMessages([]);
      }
    } catch {
      // Non-critical: chat will start fresh
      setMessages([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [storageKey]);

  // Save chat history to AsyncStorage whenever messages change
  const saveChatHistory = useCallback(async (newMessages: ChatMessage[]) => {
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(newMessages));
    } catch {
      // Non-critical: chat history won't persist, but conversation continues
    }
  }, [storageKey]);

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
            setMessages([]);
            try {
              await AsyncStorage.removeItem(storageKey);
            } catch {
              // Non-critical: stale history will be overwritten on next save
            }
          },
        },
      ]
    );
  }, [storageKey]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

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

  const handleRemoveImage = () => {
    setAttachedImage(null);
    setAttachedImageUri(null);
  };

  const handleSend = async (text?: string) => {
    const messageText = text || inputText.trim();
    if (!messageText && !attachedImage) return;

    // Capture image before clearing
    const imageToSend = attachedImage;
    const imageUriForDisplay = attachedImageUri;
    const hadImage = !!imageToSend;
    
    // Clear inputs immediately for better UX
    setInputText('');
    setAttachedImage(null);
    setAttachedImageUri(null);
    Keyboard.dismiss();
    
    // For immediate display, show local URI (will be replaced with S3 URL)
    const userMessage: ChatMessage = { 
      role: 'user', 
      content: hadImage 
        ? (messageText ? `📷 ${messageText}` : '📷 [Photo attached]')
        : messageText,
      image_url: imageUriForDisplay || undefined,
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    try {
      // If there's an image, upload to S3 first for persistent storage
      let s3ImageUrl: string | undefined;
      if (imageToSend) {
        try {
          const uploadResult = await api.uploadChatImage(imageToSend);
          s3ImageUrl = uploadResult.image_url;
          
          // Update the message with the S3 URL (replaces local URI)
          userMessage.image_url = s3ImageUrl;
          setMessages([...messages, userMessage]);
        } catch (uploadError) {
          console.log('Failed to upload image to S3, continuing without persistent URL');
          // Continue anyway - the current message will still work via base64
        }
      }

      // Prepare history for API - include S3 URLs but filter out local file:// URIs
      const historyForApi = messages.map(m => ({
        role: m.role,
        content: m.content,
        // Only include image_url if it's an S3 URL (starts with https://)
        image_url: m.image_url?.startsWith('https://') ? m.image_url : undefined,
      }));
      
      // Call the appropriate mutation based on mode
      const defaultImageMessage = isGeneralMode 
        ? 'What do you see in this image?' 
        : 'What do you see in this image? How does it relate to this recipe?';
      
      const response = isGeneralMode
        ? await cookingChatMutation.mutateAsync({
            message: messageText || defaultImageMessage,
            history: historyForApi,
            imageBase64: imageToSend || undefined,
          })
        : await recipeChatMutation.mutateAsync({
            recipeId: recipe!.id,
            message: messageText || defaultImageMessage,
            history: historyForApi,
            imageBase64: imageToSend || undefined,
          });

      // Add assistant response
      const assistantMessage: ChatMessage = { role: 'assistant', content: response.response };
      
      // Use the S3 URL (if available) for the final message
      const finalUserMessage: ChatMessage = {
        ...userMessage,
        image_url: s3ImageUrl || userMessage.image_url,
      };
      const finalMessages = [...messages, finalUserMessage, assistantMessage];
      setMessages(finalMessages);
      
      // Save to AsyncStorage - include S3 URLs (they persist), exclude local URIs
      const messagesForStorage = finalMessages.map(m => ({
        role: m.role,
        content: m.content,
        // Only save image_url if it's an S3 URL
        image_url: m.image_url?.startsWith('https://') ? m.image_url : undefined,
      }));
      await saveChatHistory(messagesForStorage as ChatMessage[]);
    } catch {
      // Add error message to conversation
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "Sorry, I couldn't process that request. Please try again.",
      };
      const errorMessages = [...updatedMessages, errorMessage];
      setMessages(errorMessages);
      await saveChatHistory(errorMessages);
    }
  };

  const handleSuggestionPress = (suggestion: string) => {
    handleSend(suggestion);
  };

  const handleCopyMessage = async (text: string, index: number) => {
    try {
      await Clipboard.setStringAsync(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedIndex(index);
      // Reset after 2 seconds
      setTimeout(() => {
        setCopiedIndex(null);
      }, 2000);
    } catch {
      Alert.alert('Error', 'Failed to copy message');
    }
  };

  const handleSpeakPress = async (text: string, index: number) => {
    if (speakingIndex === index && isPlaying) {
      // Stop if already playing this message
      await stop();
      setSpeakingIndex(null);
    } else {
      // Stop any current playback and start new
      await stop();
      setSpeakingIndex(index);
      await speak(text);
    }
  };

  // Reset speaking index when playback stops
  useEffect(() => {
    if (!isPlaying && !ttsLoading) {
      setSpeakingIndex(null);
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
          {messages.map((msg, index) => (
            <RNView
              key={index}
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
                {/* Copy button */}
                <TouchableOpacity
                  onPress={() => handleCopyMessage(msg.content, index)}
                  style={styles.actionBarButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={copiedIndex === index ? "checkmark" : "copy-outline"}
                    size={14}
                    color={copiedIndex === index ? colors.tint : colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Speak button - only for assistant */}
                {msg.role === 'assistant' && (
                  <TouchableOpacity
                    onPress={() => handleSpeakPress(msg.content, index)}
                    disabled={ttsLoading && speakingIndex === index}
                    style={styles.actionBarButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {ttsLoading && speakingIndex === index ? (
                      <ActivityIndicator size={12} color={colors.tint} />
                    ) : (
                      <Ionicons
                        name={speakingIndex === index && isPlaying ? 'stop' : 'volume-high'}
                        size={14}
                        color={speakingIndex === index && isPlaying ? colors.error : colors.textMuted}
                      />
                    )}
                  </TouchableOpacity>
                )}
              </RNView>
            </RNView>
          ))}

          {/* Loading indicator */}
          {chatMutation.isPending && (
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
            disabled={chatMutation.isPending}
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
            disabled={chatMutation.isPending}
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
            disabled={chatMutation.isPending}
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
            disabled={(!inputText.trim() && !attachedImage) || chatMutation.isPending}
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


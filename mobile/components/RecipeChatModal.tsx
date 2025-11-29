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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, useColors } from '@/components/Themed';
import { Recipe, ChatMessage } from '@/types/recipe';
import { useChatWithRecipe } from '@/hooks/useChat';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import Markdown from 'react-native-markdown-display';

// Storage key prefix for chat history
const CHAT_STORAGE_KEY_PREFIX = 'recipe_chat_';

interface RecipeChatModalProps {
  isVisible: boolean;
  onClose: () => void;
  recipe: Recipe;
}

// Quick suggestion chips
const QUICK_SUGGESTIONS = [
  "What substitutions can I make?",
  "Make this dairy-free",
  "Scale for 8 servings",
  "What wine pairs well?",
  "Any tips for this recipe?",
];

export default function RecipeChatModal({ isVisible, onClose, recipe }: RecipeChatModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  
  const chatMutation = useChatWithRecipe();
  
  const storageKey = `${CHAT_STORAGE_KEY_PREFIX}${recipe.id}`;

  // Load chat history from AsyncStorage when modal opens
  useEffect(() => {
    if (isVisible) {
      loadChatHistory();
      setInputText('');
    }
  }, [isVisible, recipe.id]);

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
    } catch (error) {
      console.error('Failed to load chat history:', error);
      setMessages([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [storageKey]);

  // Save chat history to AsyncStorage whenever messages change
  const saveChatHistory = useCallback(async (newMessages: ChatMessage[]) => {
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(newMessages));
    } catch (error) {
      console.error('Failed to save chat history:', error);
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
            } catch (error) {
              console.error('Failed to clear chat history:', error);
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

  const handleSend = async (text?: string) => {
    const messageText = text || inputText.trim();
    if (!messageText) return;

    // Add user message to chat
    const userMessage: ChatMessage = { role: 'user', content: messageText };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputText('');
    Keyboard.dismiss();

    try {
      // Send to API
      const response = await chatMutation.mutateAsync({
        recipeId: recipe.id,
        message: messageText,
        history: messages, // Send previous messages for context
      });

      // Add assistant response
      const assistantMessage: ChatMessage = { role: 'assistant', content: response.response };
      const finalMessages = [...updatedMessages, assistantMessage];
      setMessages(finalMessages);
      
      // Save to AsyncStorage
      await saveChatHistory(finalMessages);
    } catch (error) {
      console.error('Chat error:', error);
      // Add error message
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

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={isVisible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
          <RNView style={styles.headerContent}>
            <Ionicons name="chatbubbles" size={24} color={colors.tint} />
            <RNView style={styles.headerTextContainer}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                Recipe Assistant
              </Text>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {recipe.extracted.title}
              </Text>
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
                Ask me anything about this recipe!
              </Text>
              <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>
                I can help with substitutions, scaling, cooking tips, dietary modifications, and more.
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
                {QUICK_SUGGESTIONS.map((suggestion, index) => (
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
                styles.messageBubble,
                msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                {
                  backgroundColor: msg.role === 'user' ? colors.tint : colors.card,
                  borderColor: msg.role === 'user' ? colors.tint : colors.border,
                },
              ]}
            >
              {msg.role === 'assistant' && (
                <Ionicons
                  name="sparkles"
                  size={16}
                  color={colors.tint}
                  style={styles.assistantIcon}
                />
              )}
              {msg.role === 'user' ? (
                <Text style={[styles.messageText, { color: '#FFFFFF' }]}>
                  {msg.content}
                </Text>
              ) : (
                <Markdown
                  style={{
                    body: { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
                    paragraph: { marginVertical: 4 },
                    strong: { fontWeight: '700', color: colors.text },
                    em: { fontStyle: 'italic' },
                    bullet_list: { marginVertical: 4 },
                    ordered_list: { marginVertical: 4 },
                    list_item: { marginVertical: 2 },
                    bullet_list_icon: { color: colors.tint, fontSize: 8, marginRight: 8 },
                    ordered_list_icon: { color: colors.tint, fontWeight: '600' },
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

        {/* Input area */}
        <RNView
          style={[
            styles.inputContainer,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, spacing.sm),
            },
          ]}
        >
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask about this recipe..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => handleSend()}
          />
          <TouchableOpacity
            onPress={() => handleSend()}
            disabled={!inputText.trim() || chatMutation.isPending}
            style={[
              styles.sendButton,
              {
                backgroundColor: inputText.trim() ? colors.tint : colors.border,
              },
            ]}
          >
            <Ionicons
              name="send"
              size={20}
              color={inputText.trim() ? '#FFFFFF' : colors.textMuted}
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
  messageBubble: {
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    maxWidth: '85%',
    borderWidth: 1,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: radius.sm,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: radius.sm,
  },
  assistantIcon: {
    marginBottom: spacing.xs,
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
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
});


/**
 * React Query hooks for AI chat.
 */

import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ChatDeltaHandler } from '../lib/chatStream';
import { ChatMessage, ChatResponse } from '../types/recipe';

interface ChatMutationVariables {
  recipeId: string;
  message: string;
  history: ChatMessage[];
  imageBase64?: string;  // Optional image for vision
  onDelta?: ChatDeltaHandler;
  signal?: AbortSignal;
}

interface CookingChatVariables {
  message: string;
  history: ChatMessage[];
  imageBase64?: string;
  onDelta?: ChatDeltaHandler;
  signal?: AbortSignal;
}

/**
 * Mutation hook for sending a chat message about a recipe.
 * Returns the AI's response.
 */
export function useChatWithRecipe() {
  return useMutation<ChatResponse, Error, ChatMutationVariables>({
    mutationFn: ({ recipeId, message, history, imageBase64, onDelta, signal }) =>
      api.streamChatAboutRecipe(recipeId, message, history, imageBase64, onDelta, signal),
  });
}

/**
 * Mutation hook for general cooking chat (not recipe-specific).
 * Returns the AI's response.
 */
export function useCookingChat() {
  return useMutation<ChatResponse, Error, CookingChatVariables>({
    mutationFn: ({ message, history, imageBase64, onDelta, signal }) =>
      api.streamChatCookingAssistant(message, history, imageBase64, onDelta, signal),
  });
}

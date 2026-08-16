/**
 * React Query hooks for AI chat.
 */

import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ChatMessage, ChatResponse } from '../types/recipe';

interface ChatMutationVariables {
  recipeId: string;
  message: string;
  history: ChatMessage[];
  imageBase64?: string;  // Optional image for vision
}

interface CookingChatVariables {
  message: string;
  history: ChatMessage[];
  imageBase64?: string;
}

/**
 * Mutation hook for sending a chat message about a recipe.
 * Returns the AI's response.
 */
export function useChatWithRecipe() {
  return useMutation<ChatResponse, Error, ChatMutationVariables>({
    mutationFn: ({ recipeId, message, history, imageBase64 }) =>
      api.chatAboutRecipe(recipeId, message, history, imageBase64),
  });
}

/**
 * Mutation hook for general cooking chat (not recipe-specific).
 * Returns the AI's response.
 */
export function useCookingChat() {
  return useMutation<ChatResponse, Error, CookingChatVariables>({
    mutationFn: ({ message, history, imageBase64 }) =>
      api.chatCookingAssistant(message, history, imageBase64),
  });
}


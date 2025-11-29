/**
 * React Query hook for AI recipe chat.
 */

import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ChatMessage, ChatResponse } from '../types/recipe';

interface ChatMutationVariables {
  recipeId: string;
  message: string;
  history: ChatMessage[];
}

/**
 * Mutation hook for sending a chat message about a recipe.
 * Returns the AI's response.
 */
export function useChatWithRecipe() {
  return useMutation<ChatResponse, Error, ChatMutationVariables>({
    mutationFn: ({ recipeId, message, history }) =>
      api.chatAboutRecipe(recipeId, message, history),
  });
}


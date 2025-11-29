/**
 * API client for the Recipe Extractor FastAPI backend.
 */

import axios, { AxiosInstance } from 'axios';
import {
  Recipe,
  RecipeListItem,
  ExtractRequest,
  ExtractResponse,
  JobStatus,
  Location,
  GroceryItem,
  GroceryItemCreate,
  GroceryCount,
  ChatMessage,
  ChatResponse,
} from '../types/recipe';

// Configure base URL based on environment
// For local development, use your machine's IP address instead of localhost
// so the mobile device/emulator can connect
const API_BASE_URL = __DEV__
  ? 'http://192.168.1.190:8000'  // Your computer's local IP
  : 'https://recipe-api-x5na.onrender.com'; // Production URL on Render

// Token getter function type - will be set by the app
type TokenGetter = () => Promise<string | null>;

class ApiClient {
  private client: AxiosInstance;
  private getTokenFn: TokenGetter | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000, // 2 minutes for extraction
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for auth token - fetches fresh token each request
    this.client.interceptors.request.use(
      async (config) => {
        if (this.getTokenFn) {
          try {
            const token = await this.getTokenFn();
            if (token) {
              config.headers.Authorization = `Bearer ${token}`;
            }
          } catch (e) {
            console.warn('Failed to get auth token:', e);
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Set the token getter function.
   * This will be called on every request to get a fresh token.
   */
  setTokenGetter(getter: TokenGetter | null) {
    this.getTokenFn = getter;
  }

  // ============================================================
  // Health
  // ============================================================

  async healthCheck(): Promise<{ status: string; database: string }> {
    const { data } = await this.client.get('/health');
    return data;
  }

  // ============================================================
  // My Recipes (user's own recipes)
  // ============================================================

  async getRecipes(limit = 50, offset = 0, sourceType?: string): Promise<RecipeListItem[]> {
    const { data } = await this.client.get('/api/recipes/', {
      params: { limit, offset, source_type: sourceType || undefined },
    });
    return data;
  }

  async getRecipe(id: string): Promise<Recipe> {
    const { data } = await this.client.get(`/api/recipes/${id}`);
    return data;
  }

  async getRecentRecipes(limit = 10): Promise<RecipeListItem[]> {
    const { data } = await this.client.get('/api/recipes/recent', {
      params: { limit },
    });
    return data;
  }

  async searchRecipes(query: string, limit = 20, sourceType?: string): Promise<RecipeListItem[]> {
    const { data } = await this.client.get('/api/recipes/search', {
      params: { q: query, limit, source_type: sourceType || undefined },
    });
    return data;
  }

  async checkDuplicate(url: string): Promise<{
    exists: boolean;
    recipe_id?: string;
    title?: string;
  }> {
    const { data } = await this.client.get('/api/recipes/check-duplicate', {
      params: { url },
    });
    return data;
  }

  async getRecipeCount(sourceType?: string): Promise<{ count: number }> {
    const { data } = await this.client.get('/api/recipes/count', {
      params: { source_type: sourceType || undefined },
    });
    return data;
  }

  async updateRecipe(
    id: string,
    update: {
      title?: string;
      servings?: number;
      notes?: string;
      tags?: string[];
      is_public?: boolean;
    }
  ): Promise<Recipe> {
    const { data } = await this.client.put(`/api/recipes/${id}`, update);
    return data;
  }

  async deleteRecipe(id: string): Promise<{ message: string; id: string }> {
    const { data } = await this.client.delete(`/api/recipes/${id}`);
    return data;
  }

  async toggleRecipeSharing(id: string): Promise<{ is_public: boolean; message: string }> {
    const { data } = await this.client.post(`/api/recipes/${id}/share`);
    return data;
  }

  // ============================================================
  // Discover (public recipes)
  // ============================================================

  async getPublicRecipes(limit = 50, offset = 0, sourceType?: string): Promise<RecipeListItem[]> {
    const { data } = await this.client.get('/api/recipes/discover', {
      params: { limit, offset, source_type: sourceType || undefined },
    });
    return data;
  }

  async searchPublicRecipes(query: string, limit = 20, sourceType?: string): Promise<RecipeListItem[]> {
    const { data } = await this.client.get('/api/recipes/discover/search', {
      params: { q: query, limit, source_type: sourceType || undefined },
    });
    return data;
  }

  async getPublicRecipeCount(sourceType?: string): Promise<{ count: number }> {
    const { data } = await this.client.get('/api/recipes/discover/count', {
      params: { source_type: sourceType || undefined },
    });
    return data;
  }

  // ============================================================
  // Extraction
  // ============================================================

  async extractRecipe(request: ExtractRequest): Promise<ExtractResponse> {
    const { data } = await this.client.post('/api/extract', {
      url: request.url,
      location: request.location || 'Guam',
      notes: request.notes || '',
      is_public: request.is_public ?? true,  // Public by default
    });
    return data;
  }

  async startAsyncExtraction(
    request: ExtractRequest
  ): Promise<{ job_id: string; status: string; message?: string }> {
    const { data } = await this.client.post('/api/extract/async', {
      url: request.url,
      location: request.location || 'Guam',
      notes: request.notes || '',
      is_public: request.is_public ?? true,  // Public by default
    });
    return data;
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const { data } = await this.client.get(`/api/jobs/${jobId}`);
    return data;
  }

  async getLocations(): Promise<{ locations: Location[]; default: string }> {
    const { data } = await this.client.get('/api/locations');
    return data;
  }

  // ============================================================
  // Grocery List
  // ============================================================

  async getGroceryList(includeChecked = true): Promise<GroceryItem[]> {
    const { data } = await this.client.get('/api/grocery/', {
      params: { include_checked: includeChecked },
    });
    return data;
  }

  async getGroceryCount(): Promise<GroceryCount> {
    const { data } = await this.client.get('/api/grocery/count');
    return data;
  }

  async addGroceryItem(item: GroceryItemCreate): Promise<GroceryItem> {
    const { data } = await this.client.post('/api/grocery/', item);
    return data;
  }

  async addGroceryItemsFromRecipe(
    recipeId: string,
    recipeTitle: string,
    ingredients: GroceryItemCreate[]
  ): Promise<GroceryItem[]> {
    const { data } = await this.client.post('/api/grocery/from-recipe', {
      recipe_id: recipeId,
      recipe_title: recipeTitle,
      ingredients,
    });
    return data;
  }

  async toggleGroceryItem(id: string): Promise<GroceryItem> {
    const { data } = await this.client.put(`/api/grocery/${id}/toggle`);
    return data;
  }

  async updateGroceryItem(
    id: string,
    update: Partial<GroceryItemCreate> & { checked?: boolean }
  ): Promise<GroceryItem> {
    const { data } = await this.client.put(`/api/grocery/${id}`, update);
    return data;
  }

  async deleteGroceryItem(id: string): Promise<{ message: string; id: string }> {
    const { data } = await this.client.delete(`/api/grocery/${id}`);
    return data;
  }

  async clearCheckedGroceryItems(): Promise<{ message: string; count: number }> {
    const { data } = await this.client.delete('/api/grocery/clear/checked');
    return data;
  }

  async clearAllGroceryItems(): Promise<{ message: string; count: number }> {
    const { data } = await this.client.delete('/api/grocery/clear/all');
    return data;
  }

  // ============================================================
  // Recipe Chat
  // ============================================================

  async chatAboutRecipe(
    recipeId: string,
    message: string,
    history: ChatMessage[] = []
  ): Promise<ChatResponse> {
    const { data } = await this.client.post(`/api/recipes/${recipeId}/chat`, {
      message,
      history,
    });
    return data;
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export base URL for debugging
export { API_BASE_URL };

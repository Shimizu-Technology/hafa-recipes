/**
 * API client for the Recipe Extractor FastAPI backend.
 */

import axios, { AxiosInstance } from 'axios';
import {
  Recipe,
  RecipeListItem,
  PaginatedRecipes,
  ExtractRequest,
  ExtractResponse,
  JobStatus,
  Location,
  GroceryItem,
  GroceryItemCreate,
  GroceryCount,
  ChatMessage,
  ChatResponse,
  Collection,
  CollectionRecipe,
} from '../types/recipe';

// Configure base URL based on environment
import Constants from 'expo-constants';

// API Configuration
// For development: Automatically detect the dev machine's IP from Expo
// For production: Use the Render URL
// Set USE_LOCAL_API to true ONLY if you're running the backend locally with uvicorn
const USE_LOCAL_API = true; // Using local backend with uvicorn

function getApiBaseUrl(): string {
  if (!__DEV__ || !USE_LOCAL_API) {
    // Production or explicitly using remote
    return 'https://recipe-api-x5na.onrender.com';
  }
  
  // In development, try to get the IP from Expo's dev server
  // This extracts the IP from Expo's debugger host (e.g., "192.168.1.100:8081")
  const debuggerHost = Constants.expoConfig?.hostUri || Constants.manifest?.debuggerHost;
  
  if (debuggerHost) {
    const host = debuggerHost.split(':')[0]; // Remove port
    console.log(`📡 Using local API at: http://${host}:8000`);
    return `http://${host}:8000`;
  }
  
  // Fallback to production if we can't detect local IP
  console.log('⚠️ Could not detect local IP, using production API');
  return 'https://recipe-api-x5na.onrender.com';
}

const API_BASE_URL = getApiBaseUrl();

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
          // Try to get token with retry on slow networks
          let token: string | null = null;
          let attempts = 0;
          const maxAttempts = 2;
          
          while (!token && attempts < maxAttempts) {
            try {
              token = await Promise.race([
                this.getTokenFn(),
                // Timeout after 5 seconds per attempt
                new Promise<null>((_, reject) => 
                  setTimeout(() => reject(new Error('Token fetch timeout')), 5000)
                )
              ]);
            } catch (e) {
              attempts++;
              if (attempts < maxAttempts) {
                console.warn(`Token fetch attempt ${attempts} failed, retrying...`);
                await new Promise(r => setTimeout(r, 500)); // Brief delay before retry
              } else {
                console.warn('Failed to get auth token after retries:', e);
              }
            }
          }
          
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
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
        // Don't log 401 errors - they're expected when signed out
        const status = error.response?.status;
        if (status !== 401) {
          console.error('API Error:', error.response?.data || error.message);
        }
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

  async getRecipes(limit = 20, offset = 0, sourceType?: string): Promise<PaginatedRecipes> {
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

  async searchRecipes(
    query: string = '', 
    limit = 20, 
    offset = 0,
    sourceType?: string,
    timeFilter?: string,
    tags?: string[],
  ): Promise<PaginatedRecipes> {
    const { data } = await this.client.get('/api/recipes/search', {
      params: { 
        q: query || undefined, 
        limit,
        offset,
        source_type: sourceType || undefined,
        time_filter: timeFilter || undefined,
        tags: tags?.join(',') || undefined,
      },
    });
    return data;
  }

  async checkDuplicate(url: string): Promise<{
    exists: boolean;
    owned_by_user?: boolean;
    is_public?: boolean;
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

  async reExtractRecipe(id: string, location: string = "Guam"): Promise<Recipe> {
    const { data } = await this.client.post(`/api/recipes/${id}/re-extract`, { location });
    return data;
  }

  async startReExtraction(recipeId: string, location: string = "Guam"): Promise<{
    job_id: string | null;
    status: string;
    message: string;
    recipe_id: string;
  }> {
    const { data } = await this.client.post(`/api/re-extract/${recipeId}/async`, { location });
    return data;
  }

  async createManualRecipe(
    recipeData: {
      title: string;
      servings?: number | null;
      prep_time?: string | null;
      cook_time?: string | null;
      total_time?: string | null;
      ingredients: Array<{
        name: string;
        quantity?: string | null;
        unit?: string | null;
        notes?: string | null;
      }>;
      steps: string[];
      notes?: string | null;
      tags?: string[] | null;
      is_public?: boolean;
      nutrition?: {
        calories?: number;
        protein?: number;
        carbs?: number;
        fat?: number;
      } | null;
    },
    imageUri?: string | null
  ): Promise<Recipe> {
    // Create form data for multipart upload
    const formData = new FormData();
    formData.append('recipe_data', JSON.stringify(recipeData));
    
    // Add image if provided
    if (imageUri) {
      const filename = imageUri.split('/').pop() || 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';
      
      formData.append('image', {
        uri: imageUri,
        name: filename,
        type,
      } as any);
    }
    
    // Use fetch for multipart form data (axios has issues with FormData in React Native)
    const token = this.getTokenFn ? await this.getTokenFn() : null;
    
    const response = await fetch(`${API_BASE_URL}/api/recipes/manual`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to create recipe');
    }
    
    return response.json();
  }

  // ============================================================
  // Discover (public recipes)
  // ============================================================

  async getPublicRecipes(limit = 20, offset = 0, sourceType?: string): Promise<PaginatedRecipes> {
    const { data } = await this.client.get('/api/recipes/discover', {
      params: { limit, offset, source_type: sourceType || undefined },
    });
    return data;
  }

  async searchPublicRecipes(
    query: string = '', 
    limit = 20, 
    offset = 0,
    sourceType?: string,
    timeFilter?: string,
    tags?: string[],
  ): Promise<PaginatedRecipes> {
    const { data } = await this.client.get('/api/recipes/discover/search', {
      params: { 
        q: query || undefined, 
        limit,
        offset,
        source_type: sourceType || undefined,
        time_filter: timeFilter || undefined,
        tags: tags?.join(',') || undefined,
      },
    });
    return data;
  }

  async getPublicRecipeCount(sourceType?: string): Promise<{ count: number }> {
    const { data } = await this.client.get('/api/recipes/discover/count', {
      params: { source_type: sourceType || undefined },
    });
    return data;
  }

  async getPopularTags(scope: 'user' | 'public' = 'user', limit = 10): Promise<{ tag: string; count: number }[]> {
    const { data } = await this.client.get('/api/recipes/tags/popular', {
      params: { scope, limit },
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

  async suggestTags(title: string, ingredients: string[]): Promise<{ tags: string[] }> {
    const { data } = await this.client.post('/api/recipes/ai/suggest-tags', {
      title,
      ingredients,
    });
    return data;
  }

  async estimateNutrition(
    ingredients: string[],
    servings: number = 4
  ): Promise<{ nutrition: { calories: number; protein: number; carbs: number; fat: number } }> {
    const { data } = await this.client.post('/api/recipes/ai/estimate-nutrition', {
      ingredients,
      servings,
    });
    return data;
  }

  // ============================================================
  // Recipe Editing
  // ============================================================

  async editRecipe(
    recipeId: string,
    editData: {
      title: string;
      servings?: number | null;
      prep_time?: string | null;
      cook_time?: string | null;
      total_time?: string | null;
      ingredients: Array<{
        name: string;
        quantity?: string | null;
        unit?: string | null;
        notes?: string | null;
      }>;
      steps: string[];
      notes?: string | null;
      tags?: string[] | null;
      is_public?: boolean;
      nutrition?: {
        calories?: number;
        protein?: number;
        carbs?: number;
        fat?: number;
      } | null;
    },
    imageUri?: string | null
  ): Promise<Recipe> {
    // If no image, use simple PATCH
    if (!imageUri) {
      const { data } = await this.client.patch(`/api/recipes/${recipeId}`, editData);
      return data;
    }

    // With image, use FormData
    const formData = new FormData();
    formData.append('recipe_data', JSON.stringify(editData));
    
    const filename = imageUri.split('/').pop() || 'photo.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    
    formData.append('image', {
      uri: imageUri,
      name: filename,
      type,
    } as any);
    
    const token = this.getTokenFn ? await this.getTokenFn() : null;
    
    const response = await fetch(`${API_BASE_URL}/api/recipes/${recipeId}/edit`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to update recipe' }));
      throw new Error(error.detail || 'Failed to update recipe');
    }
    
    return response.json();
  }

  async restoreOriginalRecipe(recipeId: string): Promise<Recipe> {
    const { data } = await this.client.post(`/api/recipes/${recipeId}/restore`);
    return data;
  }

  async checkHasOriginal(recipeId: string): Promise<{ has_original: boolean; source_type: string }> {
    const { data } = await this.client.get(`/api/recipes/${recipeId}/has-original`);
    return data;
  }

  // ============================================================
  // Saved/Bookmarked Recipes
  // ============================================================

  async saveRecipe(recipeId: string): Promise<{ saved: boolean; message: string }> {
    const { data } = await this.client.post(`/api/recipes/${recipeId}/save`);
    return data;
  }

  async unsaveRecipe(recipeId: string): Promise<{ saved: boolean; message: string }> {
    const { data } = await this.client.delete(`/api/recipes/${recipeId}/save`);
    return data;
  }

  async checkRecipeSaved(recipeId: string): Promise<{ is_saved: boolean }> {
    const { data } = await this.client.get(`/api/recipes/${recipeId}/saved`);
    return data;
  }

  async getSavedRecipes(limit = 20, offset = 0): Promise<PaginatedRecipes> {
    const { data } = await this.client.get('/api/recipes/saved/list', {
      params: { limit, offset },
    });
    return data;
  }

  async getSavedRecipesCount(): Promise<{ count: number }> {
    const { data } = await this.client.get('/api/recipes/saved/count');
    return data;
  }

  // ============================================================
  // Collections
  // ============================================================

  async getCollections(): Promise<Collection[]> {
    const { data } = await this.client.get('/api/collections');
    return data;
  }

  async createCollection(name: string, emoji?: string): Promise<Collection> {
    const { data } = await this.client.post('/api/collections', { name, emoji });
    return data;
  }

  async updateCollection(collectionId: string, updates: { name?: string; emoji?: string }): Promise<Collection> {
    const { data } = await this.client.put(`/api/collections/${collectionId}`, updates);
    return data;
  }

  async deleteCollection(collectionId: string): Promise<void> {
    await this.client.delete(`/api/collections/${collectionId}`);
  }

  async getCollectionRecipes(collectionId: string): Promise<CollectionRecipe[]> {
    const { data } = await this.client.get(`/api/collections/${collectionId}/recipes`);
    return data;
  }

  async addRecipeToCollection(collectionId: string, recipeId: string): Promise<void> {
    await this.client.post(`/api/collections/${collectionId}/recipes`, { recipe_id: recipeId });
  }

  async removeRecipeFromCollection(collectionId: string, recipeId: string): Promise<void> {
    await this.client.delete(`/api/collections/${collectionId}/recipes/${recipeId}`);
  }

  async getRecipeCollections(recipeId: string): Promise<string[]> {
    const { data } = await this.client.get(`/api/collections/recipe/${recipeId}/collections`);
    return data;
  }

  // ============================================================
  // User Account
  // ============================================================

  async deleteAccount(): Promise<{ message: string }> {
    const { data } = await this.client.delete('/api/users/me');
    return data;
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export base URL for debugging
export { API_BASE_URL };

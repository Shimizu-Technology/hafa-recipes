/**
 * API client for the Recipe Extractor FastAPI backend.
 */

import axios, { AxiosInstance } from 'axios';
import { captureError, captureMessage, addBreadcrumb } from './sentry';
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
  MealPlanEntry,
  MealPlanEntryCreate,
  DayMeals,
  WeekPlan,
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
                addBreadcrumb('auth', `Token fetch attempt ${attempts} failed, retrying`, {
                  error: e instanceof Error ? e.message : 'Unknown error',
                }, 'warning');
                await new Promise(r => setTimeout(r, 500)); // Brief delay before retry
              } else {
                console.warn('Failed to get auth token after retries:', e);
                // Report persistent token failures to Sentry
                captureMessage('Token fetch failed after retries', 'error', {
                  tags: { endpoint: config.url || 'unknown' },
                  extra: { 
                    attempts: maxAttempts,
                    lastError: e instanceof Error ? e.message : 'Unknown error',
                  },
                });
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

    // Add response interceptor for error handling and Sentry reporting
    this.client.interceptors.response.use(
      (response) => {
        // Add breadcrumb for successful API calls
        addBreadcrumb('api', `${response.config.method?.toUpperCase()} ${response.config.url}`, {
          status: response.status,
        }, 'info');
        return response;
      },
      (error) => {
        const status = error.response?.status;
        const isNetworkError = !error.response && error.message === 'Network Error';
        const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
        const endpoint = error.config?.url || 'unknown';
        const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
        
        // Add breadcrumb for all API errors (helps debug)
        addBreadcrumb('api', `${method} ${endpoint} failed`, {
          status,
          error: error.message,
          isNetworkError,
          isTimeout,
        }, 'error');
        
        // Report to Sentry based on error type
        if (isNetworkError) {
          // Network error - user might be offline, or backend unreachable
          captureMessage('API network error', 'warning', {
            tags: { endpoint, method },
            extra: { 
              message: error.message,
              hasTokenGetter: !!this.getTokenFn,
            },
          });
        } else if (isTimeout) {
          // Timeout - could indicate backend issues
          captureMessage('API request timeout', 'warning', {
            tags: { endpoint, method },
            extra: {
              timeout: error.config?.timeout,
            },
          });
        } else if (status === 401 && this.getTokenFn) {
          // 401 with a token = auth issue (token expired/invalid)
          captureMessage('Auth token rejected by server', 'warning', {
            tags: { endpoint, method },
            extra: { status },
          });
        } else if (status && status >= 500) {
          // Server errors - definitely want to track these
          captureError(error, {
            tags: { endpoint, method, status: String(status) },
            extra: {
              responseData: error.response?.data,
            },
          });
        } else if (status !== 401 && status !== 404) {
          // Other client errors (except 401/404 which are often expected)
          captureMessage(`API error: ${status}`, 'error', {
            tags: { endpoint, method },
            extra: {
              status,
              responseData: error.response?.data,
            },
          });
        }
        
        // Console logging for development
        if (!isNetworkError && status !== 401) {
          console.warn('API Error:', error.response?.data || error.message);
        }
        if (isNetworkError && __DEV__) {
          console.log('Network connection issue - API unreachable');
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
      source_type?: 'manual' | 'photo'; // 'photo' for edited OCR recipes
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

  /**
   * Extract recipe from an image using OCR (Vision AI).
   * Supports handwritten and printed recipes.
   */
  async extractRecipeFromImage(
    imageUri: string,
    location: string = 'Guam'
  ): Promise<{
    success: boolean;
    recipe?: any;
    error?: string;
    model_used?: string;
    latency_seconds?: number;
  }> {
    // Create form data with the image
    const formData = new FormData();
    
    // Get the file name and type from the URI
    const fileName = imageUri.split('/').pop() || 'photo.jpg';
    const fileType = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    
    // Append the image as a file
    formData.append('image', {
      uri: imageUri,
      name: fileName,
      type: fileType,
    } as any);
    
    formData.append('location', location);
    
    const { data } = await this.client.post('/api/extract/ocr', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 90000, // 90 seconds for OCR
    });
    
    return data;
  }

  /**
   * Extract recipe from multiple images using OCR (Vision AI).
   * Use for multi-page recipes, front/back recipe cards, etc.
   */
  async extractRecipeFromMultipleImages(
    imageUris: string[],
    location: string = 'Guam'
  ): Promise<{
    success: boolean;
    recipe?: any;
    error?: string;
    model_used?: string;
    latency_seconds?: number;
  }> {
    // Create form data with all images
    const formData = new FormData();
    
    // Append each image
    imageUris.forEach((uri, index) => {
      const fileName = uri.split('/').pop() || `photo_${index}.jpg`;
      const fileType = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      
      formData.append('images', {
        uri: uri,
        name: fileName,
        type: fileType,
      } as any);
    });
    
    formData.append('location', location);
    
    // Increase timeout for multiple images (90s base + 30s per additional image)
    const timeout = 90000 + (imageUris.length - 1) * 30000;
    
    const { data } = await this.client.post('/api/extract/ocr/multi', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout,
    });
    
    return data;
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const { data } = await this.client.get(`/api/jobs/${jobId}`);
    return data;
  }

  /**
   * Save a recipe extracted via OCR (photo scanning).
   */
  async saveOcrRecipe(params: {
    extracted: any;
    is_public?: boolean;
  }): Promise<Recipe> {
    const { data } = await this.client.post('/api/recipes/from-ocr', {
      extracted: params.extracted,
      is_public: params.is_public ?? true,
    });
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
  // Personal Recipe Notes
  // ============================================================

  async getRecipeNote(recipeId: string): Promise<{
    id: string;
    recipe_id: string;
    note_text: string;
    created_at: string | null;
    updated_at: string | null;
  } | null> {
    const { data } = await this.client.get(`/api/recipes/${recipeId}/notes`);
    return data;
  }

  async updateRecipeNote(recipeId: string, noteText: string): Promise<{
    id: string;
    recipe_id: string;
    note_text: string;
    created_at: string | null;
    updated_at: string | null;
  }> {
    const { data } = await this.client.put(`/api/recipes/${recipeId}/notes`, {
      note_text: noteText,
    });
    return data;
  }

  async deleteRecipeNote(recipeId: string): Promise<{ deleted: boolean; message: string }> {
    const { data } = await this.client.delete(`/api/recipes/${recipeId}/notes`);
    return data;
  }

  // ============================================================
  // Recipe Version History
  // ============================================================

  async getRecipeVersions(recipeId: string): Promise<{
    id: string;
    recipe_id: string;
    version_number: number;
    change_type: string;
    change_summary: string | null;
    created_by: string | null;
    created_at: string | null;
    title: string | null;
  }[]> {
    const { data } = await this.client.get(`/api/recipes/${recipeId}/versions`);
    return data;
  }

  async getRecipeVersionDetail(recipeId: string, versionId: string): Promise<{
    id: string;
    recipe_id: string;
    version_number: number;
    extracted: any;
    thumbnail_url: string | null;
    change_type: string;
    change_summary: string | null;
    created_by: string | null;
    created_at: string | null;
  }> {
    const { data } = await this.client.get(`/api/recipes/${recipeId}/versions/${versionId}`);
    return data;
  }

  async restoreRecipeVersion(recipeId: string, versionId: string): Promise<any> {
    const { data } = await this.client.post(`/api/recipes/${recipeId}/versions/${versionId}/restore`);
    return data;
  }

  async getRecipeVersionCount(recipeId: string): Promise<{ count: number }> {
    const { data } = await this.client.get(`/api/recipes/${recipeId}/versions/count`);
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
  // Meal Planning
  // ============================================================

  async getMealPlanWeek(weekOf?: string): Promise<WeekPlan> {
    const { data } = await this.client.get('/api/meal-plans/week', {
      params: weekOf ? { week_of: weekOf } : undefined,
    });
    return data;
  }

  async getMealPlanDay(targetDate?: string): Promise<DayMeals> {
    const { data } = await this.client.get('/api/meal-plans/day', {
      params: targetDate ? { target_date: targetDate } : undefined,
    });
    return data;
  }

  async addMealPlanEntry(entry: MealPlanEntryCreate): Promise<MealPlanEntry> {
    const { data } = await this.client.post('/api/meal-plans/', entry);
    return data;
  }

  async updateMealPlanEntry(
    entryId: string,
    update: { meal_type?: string; date?: string; notes?: string; servings?: string }
  ): Promise<MealPlanEntry> {
    const { data } = await this.client.put(`/api/meal-plans/${entryId}`, update);
    return data;
  }

  async deleteMealPlanEntry(entryId: string): Promise<{ message: string; id: string }> {
    const { data } = await this.client.delete(`/api/meal-plans/${entryId}`);
    return data;
  }

  async clearMealPlanDay(targetDate: string, mealType?: string): Promise<{ message: string; count: number }> {
    const { data } = await this.client.delete(`/api/meal-plans/day/${targetDate}`, {
      params: mealType ? { meal_type: mealType } : undefined,
    });
    return data;
  }

  async addMealPlanToGrocery(startDate: string, endDate: string): Promise<{ message: string; items_added: number }> {
    const { data } = await this.client.post('/api/meal-plans/to-grocery', {
      start_date: startDate,
      end_date: endDate,
    });
    return data;
  }

  async copyMealPlanWeek(sourceWeek: string, targetWeek: string): Promise<{ message: string; entries_copied: number }> {
    const { data } = await this.client.post('/api/meal-plans/copy-week', null, {
      params: { source_week: sourceWeek, target_week: targetWeek },
    });
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

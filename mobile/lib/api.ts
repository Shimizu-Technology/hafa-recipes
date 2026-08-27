/**
 * API client for the Recipe Extractor FastAPI backend.
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { captureError, captureMessage, addBreadcrumb } from './sentry';
import { API_BASE_URL } from './apiConfig';
import {
  Recipe,
  RecipeListItem,
  PaginatedRecipes,
  IngredientSearchResponse,
  ExtractRequest,
  ExtractResponse,
  JobStatus,
  Location,
  GroceryItem,
  GroceryItemCreate,
  GroceryCount,
  GroceryListInfo,
  GrocerySnapshot,
  GroceryMutationRequest,
  GroceryMutationResponse,
  GroceryWidgetCredential,
  GroceryInvite,
  InvitePreview,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Collection,
  CollectionRecipe,
  MealPlanEntry,
  MealPlanEntryCreate,
  DayMeals,
  WeekPlan,
} from '../types/recipe';
import type {
  AppealCreatePayload,
  BlockedContributor,
  ReportCreatePayload,
  SafetyReport,
  SafetyStatus,
} from '../types/communitySafety';
import type { PublishingDisclosureStatus } from './recipePublishing';
import {
  ChatStreamUnavailableError,
  type ChatDeltaHandler,
  isChatAbortError,
  streamChatRequest,
} from './chatStream';

// Token getter function type - will be set by the app
type TokenGetter = () => Promise<string | null>;
export const AUTH_TOKEN_MAX_ATTEMPTS = 2;
export const AUTH_TOKEN_RETRY_DELAY_MS = 500;
export const AUTH_TOKEN_TIMEOUT_MS = 5_000;
export type RequestGuard = () => void;
export type CaptureSourceType = 'photo' | 'text';
export type RecipeImageUpload = {
  uri: string;
  fileName?: string;
  mimeType?: string;
};

function inferImageMimeType(fileName: string): string {
  const extension = fileName.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

type GuardedRequestConfig = AxiosRequestConfig & {
  requestGuard?: RequestGuard;
};

/** Create a platform-neutral abort error for work that ends before fetch begins. */
function createAbortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/** Wait for a promise while bounding its duration and honoring cancellation. */
function waitForTokenResult<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', handleAbort);
      callback();
    };
    const handleAbort = () => finish(() => reject(createAbortError()));
    const timeout = setTimeout(
      () => finish(() => reject(new Error('Token fetch timeout'))),
      AUTH_TOKEN_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', handleAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/** Delay between auth attempts without making a cancelled request wait. */
function waitForTokenRetry(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', handleAbort);
      callback();
    };
    const handleAbort = () => finish(() => reject(createAbortError()));
    const timeout = setTimeout(() => finish(resolve), AUTH_TOKEN_RETRY_DELAY_MS);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

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
          const token = await this.getAuthTokenWithRetry(
            config.url || 'unknown',
            config.signal as AbortSignal | undefined,
          );
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }
        (config as GuardedRequestConfig).requestGuard?.();
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

  /** Get a fresh session token with the same bounded retry for Axios and streams. */
  private async getAuthTokenWithRetry(
    endpoint: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!this.getTokenFn) return null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= AUTH_TOKEN_MAX_ATTEMPTS; attempt += 1) {
      try {
        const token = await waitForTokenResult(this.getTokenFn(), signal);
        if (token) return token;
        lastError = new Error('Token unavailable');
      } catch (error) {
        if (isChatAbortError(error, signal)) throw error;
        lastError = error;
      }
      if (attempt < AUTH_TOKEN_MAX_ATTEMPTS) {
        console.warn(`Token fetch attempt ${attempt} failed, retrying...`);
        addBreadcrumb('auth', `Token fetch attempt ${attempt} failed, retrying`, {
          error: lastError instanceof Error ? lastError.message : 'Unknown error',
        }, 'warning');
        await waitForTokenRetry(signal);
      }
    }
    console.warn('Failed to get auth token after retries:', lastError);
    captureMessage('Token fetch failed after retries', 'error', {
      tags: { endpoint },
      extra: {
        attempts: AUTH_TOKEN_MAX_ATTEMPTS,
        lastError: lastError instanceof Error ? lastError.message : 'Unknown error',
      },
    });
    return null;
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

  async searchByIngredients(
    ingredients: string[],
    includeSaved = true,
    includePublic = true,
    limit = 20,
  ): Promise<IngredientSearchResponse> {
    const { data } = await this.client.get('/api/recipes/search/by-ingredients', {
      params: { 
        ingredients: ingredients.join(','),
        include_saved: includeSaved,
        include_public: includePublic,
        limit,
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

  async setRecipeSharing(id: string, isPublic: boolean): Promise<{ is_public: boolean; message: string }> {
    const { data } = await this.client.post(`/api/recipes/${id}/share`, { is_public: isPublic });
    return data;
  }

  async getPublishingDisclosure(): Promise<PublishingDisclosureStatus> {
    const { data } = await this.client.get('/api/users/me/publishing-disclosure', { timeout: 10_000 });
    return data;
  }

  async acceptPublishingDisclosure(version: number): Promise<PublishingDisclosureStatus> {
    const { data } = await this.client.post(
      '/api/users/me/publishing-disclosure',
      { version },
      { timeout: 10_000 },
    );
    return data;
  }

  async reExtractRecipe(id: string, location: string = "Guam"): Promise<Recipe> {
    const { data } = await this.client.post(`/api/recipes/${id}/re-extract`, { location });
    return data;
  }

  async startReExtraction(recipeId: string, location: string = "Guam", idempotencyKey?: string): Promise<{
    job_id: string | null;
    status: string;
    message: string;
    recipe_id: string;
    is_existing?: boolean;
  }> {
    const { data } = await this.client.post(
      `/api/re-extract/${recipeId}/async`,
      { location },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    );
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
      source_type?: 'manual' | CaptureSourceType;
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
    const token = await this.getAuthTokenWithRetry('/api/recipes/manual');
    
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

  async getPublicRecipes(
    limit = 20, 
    offset = 0, 
    sourceType?: string,
    sort: 'recent' | 'random' | 'popular' = 'recent',
    extractorId?: string,
    mealType?: string,
  ): Promise<PaginatedRecipes> {
    const { data } = await this.client.get('/api/recipes/discover', {
      params: { 
        limit, 
        offset, 
        source_type: sourceType || undefined, 
        sort,
        extractor_id: extractorId || undefined,
        meal_type: mealType || undefined,
      },
    });
    return data;
  }

  async getRandomRecipe(mealType?: string, sourceType?: string): Promise<RecipeListItem> {
    const { data } = await this.client.get('/api/recipes/discover/random', {
      params: { 
        meal_type: mealType || undefined,
        source_type: sourceType || undefined,
      },
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
    extractorId?: string,
    mealType?: string,
  ): Promise<PaginatedRecipes> {
    const { data } = await this.client.get('/api/recipes/discover/search', {
      params: { 
        q: query || undefined, 
        limit,
        offset,
        source_type: sourceType || undefined,
        time_filter: timeFilter || undefined,
        tags: tags?.join(',') || undefined,
        extractor_id: extractorId || undefined,
        meal_type: mealType || undefined,
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

  async getTopContributors(limit = 8): Promise<{ user_id: string; contributor_id?: string; display_name: string; recipe_count: number }[]> {
    const { data } = await this.client.get('/api/recipes/discover/contributors', {
      params: { limit },
    });
    return data;
  }

  async getAllContributors(): Promise<{ user_id: string; contributor_id?: string; display_name: string; recipe_count: number }[]> {
    const { data } = await this.client.get('/api/recipes/discover/contributors', {
      params: { limit: 100 },
    });
    return data;
  }

  // ============================================================
  // Community safety
  // ============================================================

  async createReport(payload: ReportCreatePayload): Promise<SafetyReport> {
    const { data } = await this.client.post('/api/reports', payload);
    return data;
  }

  async getMyReports(): Promise<SafetyReport[]> {
    const { data } = await this.client.get('/api/reports/mine');
    return data;
  }

  async createAppeal(payload: AppealCreatePayload): Promise<SafetyReport> {
    const { data } = await this.client.post('/api/appeals', payload);
    return data;
  }

  async getSafetyStatus(): Promise<SafetyStatus> {
    const { data } = await this.client.get('/api/safety/status');
    return data;
  }

  async getBlockedContributors(): Promise<BlockedContributor[]> {
    const { data } = await this.client.get('/api/blocks');
    return data;
  }

  async blockContributor(contributorId: string): Promise<BlockedContributor> {
    const { data } = await this.client.post(`/api/blocks/${encodeURIComponent(contributorId)}`);
    return data;
  }

  async unblockContributor(contributorId: string): Promise<void> {
    await this.client.delete(`/api/blocks/${encodeURIComponent(contributorId)}`);
  }

  async getSimilarRecipes(recipeId: string, limit = 6): Promise<RecipeListItem[]> {
    const { data } = await this.client.get(`/api/recipes/similar/${recipeId}`, {
      params: { limit },
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
      is_public: request.is_public ?? false,
    });
    return data;
  }

  async startAsyncExtraction(
    request: ExtractRequest,
    idempotencyKey?: string,
  ): Promise<{
    job_id: string | null;
    status: string;
    message?: string;
    recipe_id?: string;
    is_existing?: boolean;
  }> {
    const { data } = await this.client.post(
      '/api/extract/async',
      {
        url: request.url,
        location: request.location || 'Guam',
        notes: request.notes || '',
        is_public: request.is_public ?? false,
      },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    );
    return data;
  }

  /**
   * Extract recipe from an image using OCR (Vision AI).
   * Supports handwritten and printed recipes.
   */
  async extractRecipeFromImage(
    image: string | RecipeImageUpload,
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
    const imageUri = typeof image === 'string' ? image : image.uri;
    const uriFileName = imageUri.split('/').pop()?.split('?')[0] || 'photo.jpg';
    const fileName = typeof image === 'string'
      ? uriFileName
      : image.fileName || uriFileName;
    const fileType = typeof image === 'string'
      ? inferImageMimeType(fileName)
      : image.mimeType || inferImageMimeType(fileName);
    
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
    images: Array<string | RecipeImageUpload>,
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
    images.forEach((image, index) => {
      const uri = typeof image === 'string' ? image : image.uri;
      const fileName = uri.split('/').pop()?.split('?')[0] || `photo_${index}.jpg`;
      const uploadName = typeof image === 'string' ? fileName : image.fileName || fileName;
      const fileType = typeof image === 'string'
        ? inferImageMimeType(uploadName)
        : image.mimeType || inferImageMimeType(uploadName);
      
      formData.append('images', {
        uri: uri,
        name: uploadName,
        type: fileType,
      } as any);
    });
    
    formData.append('location', location);
    
    // Increase timeout for multiple images (90s base + 30s per additional image)
    const timeout = 90000 + (images.length - 1) * 30000;
    
    const { data } = await this.client.post('/api/extract/ocr/multi', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout,
    });
    
    return data;
  }

  /** Extract a reviewable recipe draft from user-pasted text. */
  async extractRecipeFromText(
    text: string,
    location: string = 'Guam'
  ): Promise<{
    success: boolean;
    recipe?: any;
    error?: string;
    model_used?: string;
    latency_seconds?: number;
  }> {
    const { data } = await this.client.post(
      '/api/extract/text',
      { text, location },
      { timeout: 90000 },
    );
    return data;
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const { data } = await this.client.get(`/api/jobs/${jobId}`);
    return data;
  }

  /**
   * Cancel an extraction job.
   */
  async cancelJob(jobId: string): Promise<{ message: string; job_id: string }> {
    const { data } = await this.client.delete(`/api/jobs/${jobId}`);
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
      is_public: params.is_public ?? false,
    });
    return data;
  }

  /** Save a source-aware recipe created by a photo or pasted-text capture. */
  async saveCapturedRecipe(params: {
    extracted: any;
    source_type: CaptureSourceType;
    is_public?: boolean;
  }): Promise<Recipe> {
    const { data } = await this.client.post('/api/recipes/from-capture', {
      extracted: params.extracted,
      source_type: params.source_type,
      is_public: params.is_public ?? false,
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

  async getGrocerySnapshot(): Promise<GrocerySnapshot> {
    const { data } = await this.client.get('/api/grocery/snapshot');
    return data;
  }

  async syncGroceryMutation(
    mutation: GroceryMutationRequest,
    requestGuard?: RequestGuard,
  ): Promise<GroceryMutationResponse> {
    const { data } = await this.client.post('/api/grocery/sync', mutation, {
      requestGuard,
    } as GuardedRequestConfig);
    return data;
  }

  async issueGroceryWidgetCredential(
    installationId: string,
    requestGuard?: RequestGuard,
  ): Promise<GroceryWidgetCredential> {
    const { data } = await this.client.post(
      '/api/grocery/widget/credentials',
      { installation_id: installationId },
      { requestGuard } as GuardedRequestConfig,
    );
    return data;
  }

  async revokeGroceryWidgetCredential(
    credentialId: string,
    requestGuard?: RequestGuard,
  ): Promise<void> {
    await this.client.delete(`/api/grocery/widget/credentials/${credentialId}`, {
      requestGuard,
    } as GuardedRequestConfig);
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

  async clearRecipeGroceryItems(recipeId: string): Promise<{ message: string; count: number; recipe_id: string }> {
    const { data } = await this.client.delete(`/api/grocery/clear/recipe/${recipeId}`);
    return data;
  }

  // ============================================================
  // Shared Grocery List
  // ============================================================

  async getGroceryListInfo(): Promise<GroceryListInfo> {
    const { data } = await this.client.get('/api/grocery/list');
    return data;
  }

  async createGroceryInvite(requestGuard?: RequestGuard): Promise<GroceryInvite> {
    const { data } = await this.client.post(
      '/api/grocery/list/invite',
      undefined,
      { requestGuard } as GuardedRequestConfig,
    );
    return data;
  }

  async getInvitePreview(code: string): Promise<InvitePreview> {
    const { data } = await this.client.get(`/api/grocery/list/invite/${code}`);
    return data;
  }

  async joinGroceryList(code: string, requestGuard?: RequestGuard): Promise<{ message: string }> {
    const { data } = await this.client.post(
      `/api/grocery/list/join/${code}`,
      undefined,
      { requestGuard } as GuardedRequestConfig,
    );
    return data;
  }

  async leaveGroceryList(requestGuard?: RequestGuard): Promise<{ message: string }> {
    const { data } = await this.client.delete('/api/grocery/list/leave', {
      requestGuard,
    } as GuardedRequestConfig);
    return data;
  }

  async removeGroceryListMember(
    userId: string,
    requestGuard?: RequestGuard,
  ): Promise<{ message: string }> {
    const { data } = await this.client.delete(`/api/grocery/list/members/${userId}`, {
      requestGuard,
    } as GuardedRequestConfig);
    return data;
  }

  // ============================================================
  // Recipe Chat
  // ============================================================

  /** Prefer progressive NDJSON, falling back only when an older API lacks the route. */
  private async streamChatWithFallback(
    streamPath: string,
    fallbackPath: string,
    payload: ChatRequest,
    onDelta?: ChatDeltaHandler,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const token = await this.getAuthTokenWithRetry(streamPath, signal);
    try {
      const result = await streamChatRequest({
        url: `${API_BASE_URL}${streamPath}`,
        token,
        payload,
        onDelta,
        signal,
      });
      addBreadcrumb('api', `POST ${streamPath}`, { status: 200, streamed: true }, 'info');
      return result;
    } catch (error) {
      if (error instanceof ChatStreamUnavailableError && !signal?.aborted) {
        const { data } = await this.client.post<ChatResponse>(fallbackPath, payload, { signal });
        onDelta?.(data.response, data.response);
        return data;
      }
      if (!isChatAbortError(error, signal)) {
        const streamError = error as {
          code?: string;
          message?: string;
          response?: { status?: number; data?: unknown };
        };
        const status = streamError.response?.status;
        addBreadcrumb('api', `POST ${streamPath} failed`, {
          status,
          error: streamError.message || 'Unknown error',
          streamed: true,
        }, 'error');
        if (streamError.code === 'ERR_NETWORK') {
          captureMessage('API network error', 'warning', {
            tags: { endpoint: streamPath, method: 'POST' },
          });
        } else if (status === 401) {
          captureMessage('Auth token rejected by server', 'warning', {
            tags: { endpoint: streamPath, method: 'POST' },
          });
        } else if (status && status >= 500 && error instanceof Error) {
          captureError(error, {
            tags: { endpoint: streamPath, method: 'POST', status: String(status) },
            extra: { responseData: streamError.response?.data },
          });
        }
      }
      throw error;
    }
  }

  async chatAboutRecipe(
    recipeId: string,
    message: string,
    history: ChatMessage[] = [],
    imageBase64?: string
  ): Promise<ChatResponse> {
    const { data } = await this.client.post(`/api/recipes/${recipeId}/chat`, {
      message,
      history,
      image_base64: imageBase64,
    });
    return data;
  }

  async streamChatAboutRecipe(
    recipeId: string,
    message: string,
    history: ChatMessage[] = [],
    imageBase64?: string,
    onDelta?: ChatDeltaHandler,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const path = `/api/recipes/${encodeURIComponent(recipeId)}/chat`;
    return this.streamChatWithFallback(
      `${path}/stream`,
      path,
      { message, history, image_base64: imageBase64 },
      onDelta,
      signal,
    );
  }

  /**
   * General cooking chat assistant (not recipe-specific).
   */
  async chatCookingAssistant(
    message: string,
    history: ChatMessage[] = [],
    imageBase64?: string
  ): Promise<ChatResponse> {
    const { data } = await this.client.post('/api/chat/cooking', {
      message,
      history,
      image_base64: imageBase64,
    });
    return data;
  }

  async streamChatCookingAssistant(
    message: string,
    history: ChatMessage[] = [],
    imageBase64?: string,
    onDelta?: ChatDeltaHandler,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    return this.streamChatWithFallback(
      '/api/chat/cooking/stream',
      '/api/chat/cooking',
      { message, history, image_base64: imageBase64 },
      onDelta,
      signal,
    );
  }

  /**
   * Upload a chat image to S3 for persistent storage.
   * Returns the S3 URL that can be used in chat history.
   */
  async uploadChatImage(
    imageBase64: string,
    signal?: AbortSignal,
  ): Promise<{ image_url: string }> {
    const { data } = await this.client.post('/api/recipes/ai/upload-chat-image', {
      image_base64: imageBase64,
    }, { signal });
    return data;
  }

  /** Resolve the auth session to the backend's durable application owner. */
  async getCurrentUserIdentity(): Promise<{ id: string }> {
    const { data } = await this.client.get('/api/users/me/identity', { timeout: 10_000 });
    return data;
  }

  /** Delete exact app-owned image objects when their local conversation is cleared. */
  async deleteChatImages(imageUrls: string[]): Promise<{ deleted: number }> {
    let deleted = 0;
    for (let start = 0; start < imageUrls.length; start += 50) {
      const { data } = await this.client.post('/api/recipes/ai/delete-chat-images', {
        image_urls: imageUrls.slice(start, start + 50),
      });
      deleted += data.deleted;
    }
    return { deleted };
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
  ): Promise<{
    nutrition: { calories: number; protein: number; carbs: number; fat: number };
    model: string;
    calculated_at: string;
  }> {
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
      components?: Array<{
        name: string;
        ingredients: Array<{
          name: string;
          quantity?: string | null;
          unit?: string | null;
          notes?: string | null;
          estimatedCost?: number | null;
        }>;
        steps: string[];
        notes?: string | null;
      }>;
      ingredients: Array<{
        name: string;
        quantity?: string | null;
        unit?: string | null;
        notes?: string | null;
        estimatedCost?: number | null;
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
      nutrition_recalculated?: boolean;
      nutrition_model?: string | null;
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

  async getRecipeMealPlanEntries(
    recipeId: string,
    startDate?: string,
  ): Promise<MealPlanEntry[]> {
    const { data } = await this.client.get(`/api/meal-plans/recipe/${recipeId}`, {
      params: startDate ? { start_date: startDate } : undefined,
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
  // Text-to-Speech
  // ============================================================

  async generateTTS(text: string, voice: string = 'nova'): Promise<Blob> {
    const response = await this.client.post(
      '/api/tts',
      { text, voice },
      { responseType: 'blob' }
    );
    return response.data;
  }

  async getTTSVoices(): Promise<{
    voices: { id: string; name: string; description: string }[];
    default: string;
  }> {
    const { data } = await this.client.get('/api/tts/voices');
    return data;
  }

  // ============================================================
  // User Account
  // ============================================================

  async deleteAccount(): Promise<{
    message: string;
    deleted: { recipes: number };
    cleanup: {
      id: string;
      status: 'queued' | 'processing' | 'completed' | 'failed';
      clerk_accounts: number;
      storage_prefixes: number;
    };
  }> {
    const { data } = await this.client.delete('/api/users/me');
    return data;
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export base URL for debugging
export { API_BASE_URL };

// Backward-compatible default export for older components
export default api;

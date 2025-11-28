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
} from '../types/recipe';

// Configure base URL based on environment
// For local development, use your machine's IP address instead of localhost
// so the mobile device/emulator can connect
const API_BASE_URL = __DEV__
  ? 'http://192.168.1.190:8000'  // Your computer's local IP
  : 'https://recipe-api-x5na.onrender.com'; // Production URL on Render

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000, // 2 minutes for extraction
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  // ============================================================
  // Health
  // ============================================================

  async healthCheck(): Promise<{ status: string; database: string }> {
    const { data } = await this.client.get('/health');
    return data;
  }

  // ============================================================
  // Recipes
  // ============================================================

  async getRecipes(limit = 50, offset = 0): Promise<RecipeListItem[]> {
    const { data } = await this.client.get('/api/recipes/', {
      params: { limit, offset },
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

  async searchRecipes(query: string, limit = 20): Promise<RecipeListItem[]> {
    const { data } = await this.client.get('/api/recipes/search', {
      params: { q: query, limit },
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

  async getRecipeCount(): Promise<{ count: number }> {
    const { data } = await this.client.get('/api/recipes/count');
    return data;
  }

  async updateRecipe(
    id: string,
    update: {
      title?: string;
      servings?: number;
      notes?: string;
      tags?: string[];
    }
  ): Promise<Recipe> {
    const { data } = await this.client.put(`/api/recipes/${id}`, update);
    return data;
  }

  async deleteRecipe(id: string): Promise<{ message: string; id: string }> {
    const { data } = await this.client.delete(`/api/recipes/${id}`);
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
}

// Export singleton instance
export const api = new ApiClient();

// Export base URL for debugging
export { API_BASE_URL };


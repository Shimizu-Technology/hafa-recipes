/**
 * Recipe types matching the FastAPI backend schemas.
 */

export interface Ingredient {
  quantity: string | null;
  unit: string | null;
  name: string;
  notes?: string | null;
  estimatedCost?: number | null;
}

export interface RecipeComponent {
  name: string;
  ingredients: Ingredient[];
  steps: string[];
  notes?: string | null;
}

export interface Times {
  prep: string | null;
  cook: string | null;
  total: string | null;
}

export interface NutritionValues {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
}

export interface Nutrition {
  perServing: NutritionValues;
  total: NutritionValues;
}

export interface Media {
  thumbnail: string | null;
}

export interface RecipeExtracted {
  title: string;
  sourceUrl: string;
  servings: number | null;
  times: Times;
  components: RecipeComponent[];
  ingredients: Ingredient[];
  steps: string[];
  equipment: string[] | null;
  notes?: string | null;
  tags: string[];
  media: Media;
  totalEstimatedCost: number | null;
  costLocation: string;
  nutrition: Nutrition;
}

export interface Recipe {
  id: string;
  source_url: string;
  source_type: string;
  raw_text?: string | null;
  extracted: RecipeExtracted;
  thumbnail_url: string | null;
  extraction_method: string | null;
  extraction_quality: string | null;
  has_audio_transcript: boolean;
  created_at: string;
  user_id: string | null;
  is_public: boolean;
}

export interface RecipeListItem {
  id: string;
  title: string;
  source_url: string;
  source_type: string;
  thumbnail_url: string | null;
  extraction_quality: string | null;
  has_audio_transcript: boolean;
  tags: string[];
  servings: number | null;
  total_time: string | null;
  created_at: string;
  user_id: string | null;
  is_public: boolean;
}

export interface PaginatedRecipes {
  items: RecipeListItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ExtractRequest {
  url: string;
  location?: string;
  notes?: string;
  is_public?: boolean;  // Default true - share to library
}

export interface ExtractResponse {
  id: string;
  recipe: RecipeExtracted;
  is_existing: boolean;
}

export interface JobStatus {
  id: string;
  url: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  current_step: string;
  message: string;
  recipe_id: string | null;
  error_message: string | null;
}

export interface Location {
  code: string;
  name: string;
  description: string;
}

// ============================================================
// Grocery List Types
// ============================================================

export interface GroceryItem {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  notes: string | null;
  checked: boolean;
  recipe_id: string | null;
  recipe_title: string | null;
  created_at: string;
}

export interface GroceryItemCreate {
  name: string;
  quantity?: string | null;
  unit?: string | null;
  notes?: string | null;
  recipe_id?: string | null;
  recipe_title?: string | null;
}

export interface GroceryCount {
  total: number;
  unchecked: number;
  checked: number;
}

// ============================================================
// Chat Types
// ============================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

export interface ChatResponse {
  response: string;
}

// ============================================================
// Collections
// ============================================================

export interface Collection {
  id: string;
  name: string;
  emoji: string | null;
  recipe_count: number;
  created_at: string;
  updated_at: string;
  preview_thumbnails?: (string | null)[];
}

export interface CollectionRecipe {
  id: string;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
  tags: string[];
  total_time: string | null;
  servings: number | null;
  added_at: string;
}


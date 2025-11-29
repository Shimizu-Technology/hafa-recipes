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


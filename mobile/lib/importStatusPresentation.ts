import type { Recipe, RecipeReviewState } from '@/types/recipe';

type ImportStatus = {
  isExtracting: boolean; isComplete: boolean; isFailed: boolean; progress: number;
  currentStep: string; message: string; connectionNotice?: string | null; error?: string | null;
  terminalStatus?: 'failed' | 'cancelled' | 'expired' | null; isRetrying?: boolean;
  reviewState?: RecipeReviewState | null;
};
const STAGES: Record<string, string> = {
  queued: 'Waiting to start', initializing: 'Starting your import', detecting: 'Checking the source',
  metadata: 'Reading the video details', downloading: 'Reading the video', transcribing: 'Listening for the recipe',
  metadata_fallback: 'Reading the caption', fetching: 'Reading the recipe page',
  extracting: 'Putting the recipe together', saving: 'Saving your recipe',
};
export function getImportStatusPresentation(status: ImportStatus, recipe?: Pick<Recipe, 'is_public' | 'moderation_status' | 'review_state'>) {
  const progress = Number.isFinite(status.progress) ? Math.min(100, Math.max(0, Math.round(status.progress))) : 0;
  if (status.isFailed) return {
    title: status.terminalStatus === 'cancelled' ? 'Import cancelled' : status.terminalStatus === 'expired' ? 'Import expired' : 'Import needs attention',
    description: status.error || 'Your source is saved. Try importing again.', progress,
  };
  if (status.isComplete) {
    const draft = (recipe?.review_state ?? status.reviewState) === 'source_incomplete';
    const visibility = !recipe ? 'Saved to your library' : recipe.moderation_status === 'hidden' && recipe.is_public
      ? 'Public · Hidden from Discover while under review' : recipe.is_public ? 'Public in Discover' : 'Private recipe';
    return { title: draft ? 'Draft saved' : 'Recipe saved',
      description: draft ? 'Private draft · Add missing details before publishing.' : visibility, progress };
  }
  return { title: status.isRetrying ? 'Import retrying' : 'Importing recipe',
    description: status.connectionNotice || (status.isRetrying ? 'Your source is saved. We’ll try again automatically.'
      : STAGES[status.currentStep] || status.message || 'Your recipe will be saved to your library.'), progress };
}

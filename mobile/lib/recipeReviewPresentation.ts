import type { RecipeReviewState } from '@/types/recipe';

type ReviewEvidence = {
  source?: {
    modalities?: unknown;
    frames?: unknown;
  };
  assessment?: {
    missingQuantityCount?: unknown;
  };
};

export type RecipeReviewDetails = {
  actionLabel: string;
  heading: string;
  message: string;
  missingQuantityCount: number;
  sourceSummary: string | null;
};

const MODALITY_LABELS: Record<string, string> = {
  metadata: 'caption and post details',
  audio_transcript: 'spoken audio',
  video_frames: 'video frames',
  slideshow_images: 'slideshow images',
  website_data: 'website recipe data',
  manual: 'manual entry',
};
const NULLISH_INSTRUCTIONS = new Set(['', 'null', 'none', 'n/a', 'not stated', 'unknown']);

/** Join source labels as a short natural-language list. */
function listPhrase(values: string[]): string {
  if (values.length < 2) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

/** Format a bounded frame offset as minutes and seconds. */
function formatTimestamp(value: number): string {
  const wholeSeconds = Math.max(0, Math.round(value));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

/** Build owner-facing review copy from privacy-bounded extraction evidence. */
export function getRecipeReviewDetails(
  state: RecipeReviewState | null | undefined,
  uncertaintyCount: number | null | undefined,
  evidence: Record<string, unknown> | null | undefined,
): RecipeReviewDetails | null {
  if (state !== 'source_incomplete' && state !== 'needs_review') return null;

  const envelope = (evidence && typeof evidence === 'object' ? evidence : {}) as ReviewEvidence;
  const rawMissing = envelope.assessment?.missingQuantityCount;
  const missingQuantityCount = typeof rawMissing === 'number' && rawMissing > 0
    ? Math.floor(rawMissing)
    : 0;
  const issueCount = typeof uncertaintyCount === 'number' && uncertaintyCount > 0
    ? Math.floor(uncertaintyCount)
    : 0;

  const actionLabel = state === 'source_incomplete'
    ? 'Add missing details'
    : missingQuantityCount > 0
      ? `Review ${missingQuantityCount} ${missingQuantityCount === 1 ? 'amount' : 'amounts'}`
      : issueCount > 0
        ? `Review ${issueCount} ${issueCount === 1 ? 'detail' : 'details'}`
        : 'Review recipe';
  const heading = state === 'source_incomplete'
    ? 'Finish this saved draft'
    : missingQuantityCount > 0
      ? `${missingQuantityCount} ingredient ${missingQuantityCount === 1 ? 'amount was' : 'amounts were'} not stated`
      : 'Compare this draft with the original';
  const message = state === 'source_incomplete'
    ? 'Keep what was recovered, then add the ingredients or instructions the source did not provide.'
    : missingQuantityCount > 0
      ? 'Missing amounts stay blank instead of being guessed. Add them only if you can verify them from the source.'
      : 'The imported details have not been verified by a person yet.';

  const modalities = Array.isArray(envelope.source?.modalities)
    ? envelope.source.modalities
      .filter((value): value is string => typeof value === 'string' && !!MODALITY_LABELS[value])
      .map(value => MODALITY_LABELS[value])
    : [];
  const rawFrames = Array.isArray(envelope.source?.frames) ? envelope.source.frames : [];
  const timestamps = rawFrames
    .map(frame => (
      frame && typeof frame === 'object'
        ? (frame as { timestampSeconds?: unknown }).timestampSeconds
        : null
    ))
    .filter((value): value is number => typeof value === 'number' && value >= 0);
  let sourceSummary = modalities.length > 0
    ? `Checked ${listPhrase(Array.from(new Set(modalities)))}.`
    : null;
  if (timestamps.length > 0) {
    const visible = timestamps.slice(0, 4).map(formatTimestamp);
    const remainder = timestamps.length - visible.length;
    sourceSummary = `${sourceSummary ? sourceSummary.slice(0, -1) : 'Checked video'} at ${visible.join(', ')}${remainder > 0 ? `, +${remainder} more` : ''}.`;
  }

  return {
    actionLabel,
    heading,
    message,
    missingQuantityCount,
    sourceSummary,
  };
}

/** Present the persisted recipe-review state in concise cooking language. */
export function getRecipeReviewLabel(state?: RecipeReviewState | null): string | null {
  if (state === 'source_incomplete') return 'Source incomplete · Add what the source did not show';
  if (state === 'needs_review') return 'Needs review · Compare this draft with the original';
  if (state === 'ready') return 'Ready to cook';
  return null;
}

/** Count only instructions containing an actual cooking action. */
export function countUsableInstructions(
  components: Array<{ steps?: unknown }> | null | undefined,
): number {
  return (components || []).reduce((total, component) => {
    if (!Array.isArray(component.steps)) return total;
    return total + component.steps.filter(step => (
      typeof step === 'string'
      && !NULLISH_INSTRUCTIONS.has(step.trim().toLowerCase())
    )).length;
  }, 0);
}

/** Describe whether a recipe can enter cook mode and what warning it needs. */
export function getCookDraftPresentation(
  state: RecipeReviewState | null | undefined,
  instructionCount: number,
) {
  if (instructionCount === 0) {
    return {
      canCook: false,
      buttonLabel: 'Add instructions to cook',
      alertTitle: 'Instructions needed',
      alertMessage: 'This saved source does not have cooking instructions yet. Add them while viewing the original.',
    };
  }
  if (state === 'source_incomplete' || state === 'needs_review') {
    return {
      canCook: true,
      buttonLabel: 'Cook with draft',
      alertTitle: state === 'source_incomplete' ? 'Cook with an incomplete draft?' : 'Cook with an unverified draft?',
      alertMessage: 'Some cooking-critical details may be missing or inaccurate. Compare this draft with the original source as you cook.',
    };
  }
  return {
    canCook: true,
    buttonLabel: 'Start Cooking',
    alertTitle: null,
    alertMessage: null,
  };
}

/** Label an absent amount honestly unless the source explicitly supplied flexibility. */
export function getMissingQuantityLabel(
  _state: RecipeReviewState | null | undefined,
  ingredient: { name?: string | null; quantity?: string | null; unit?: string | null; notes?: string | null },
): string | null {
  const nullish = new Set(['', 'null', 'none', 'n/a', 'not stated', 'unknown']);
  const hasStatedValue = (value?: string | null) => (
    !!value && !nullish.has(value.trim().toLowerCase())
  );
  if (hasStatedValue(ingredient.quantity)) return null;
  const sourceLanguage = `${ingredient.name || ''} ${ingredient.unit || ''} ${ingredient.notes || ''}`.toLowerCase();
  if (['to taste', 'as needed', 'as desired', 'for garnish', 'optional'].some(
    phrase => sourceLanguage.includes(phrase),
  )) return null;
  return 'Not stated — verify original';
}

/** Trust the API's stable-identity ownership verdict, not a Clerk subject. */
export function isRecipeOwner(recipe?: { is_owner?: boolean | null } | null): boolean {
  return recipe?.is_owner === true;
}

/** Allow source actions only for fetchable web URLs. */
export function canOpenRecipeOriginal(sourceUrl?: string | null): boolean {
  return /^https?:\/\//i.test(sourceUrl || '');
}

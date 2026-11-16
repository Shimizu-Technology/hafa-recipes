import type { Recipe } from '@/types/recipe';
import { formatQuantity, joinAmountAndUnit, parseQuantity } from './quantityPresentation';
import { getCookingNotes, getIngredientAmount } from './recipeTrust';

/** Every Håfa recipe link lives here; the website serves /r/* and the app claims it as a universal link. */
export const RECIPE_LINK_ORIGIN = 'https://hafa-recipes.com';

export function publicRecipeLink(recipeId: string): string {
  return `${RECIPE_LINK_ORIGIN}/r/${recipeId}`;
}

/**
 * How the sheet can share a recipe.
 * - public: anyone can open the recipe's own link.
 * - private: the owner can create an unlisted link on demand.
 * - under-review: hidden by moderation, so no link opens for others; text only.
 * - text-only: someone else's recipe that is no longer public.
 */
export type RecipeShareMode = 'public' | 'private' | 'under-review' | 'text-only';

export function getRecipeShareMode(recipe: Pick<Recipe, 'is_public' | 'moderation_status'>, isOwner: boolean): RecipeShareMode {
  if (recipe.moderation_status === 'hidden') return isOwner ? 'under-review' : 'text-only';
  if (recipe.is_public) return 'public';
  return isOwner ? 'private' : 'text-only';
}

export type SourceCredit = { url: string; label: string; handle: string | null };

/** "TikTok video by @creator" style credit for the original source, or null for manual and photo recipes. */
export function getSourceCredit(sourceUrl: string | null | undefined, sourceType: string | null | undefined): SourceCredit | null {
  let url: URL;
  try {
    url = new URL(sourceUrl || '');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  const handle = url.pathname.match(/^\/(@[A-Za-z0-9._]{1,40})(?:\/|$)/)?.[1] ?? null;
  const by = handle ? ` by ${handle}` : '';
  const credit = (label: string) => ({ url: url.href, label, handle });
  if (sourceType === 'tiktok' || host.endsWith('tiktok.com')) return credit(`TikTok video${by}`);
  if (sourceType === 'instagram' || host.endsWith('instagram.com')) return credit(`Instagram post${by}`);
  if (sourceType === 'youtube' || host.endsWith('youtube.com') || host === 'youtu.be') return credit(`YouTube video${by}`);
  return credit(`Recipe from ${host}`);
}

const FLEXIBLE_AMOUNT = /^(?:to taste|as needed|as desired|for garnish|optional)$/;

type ShareIngredient = Pick<Recipe['extracted']['components'][number]['ingredients'][number], 'name' | 'quantity' | 'unit' | 'notes' | 'quantityEstimate'>;

/** "≈ ½ tsp salt (fine)" or "pepper, to taste"; ≈ marks an amount Håfa estimated. */
export function formatShareIngredient(ingredient: ShareIngredient, scaleFactor = 1): string {
  const amount = getIngredientAmount(ingredient);
  const notes = getCookingNotes(ingredient.notes);
  const suffix = notes ? ` (${notes})` : '';
  if (amount.quantity && FLEXIBLE_AMOUNT.test(amount.quantity)) {
    // The phrase usually came from the notes ("to taste"); say it once.
    const rest = notes && notes.trim().toLowerCase() !== amount.quantity ? ` (${notes})` : '';
    return `${ingredient.name}, ${amount.quantity}${rest}`;
  }
  const parsed = amount.quantity ? parseQuantity(amount.quantity) : null;
  const scaled = parsed === null ? amount.quantity : formatQuantity(String(parsed * scaleFactor), amount.unit);
  const quantity = joinAmountAndUnit(scaled, amount.unit);
  return `${amount.isEstimate ? '≈ ' : ''}${quantity ? `${quantity} ` : ''}${ingredient.name}${suffix}`;
}

export type RecipeShareTextOptions = {
  /** The servings the text is written for; equal to the original when not scaled. */
  servings?: number | null;
  /** Håfa link to end with, when one exists. */
  link?: string | null;
  /** Credit someone else's Discover recipe ("Recipe by … on Håfa"). */
  contributorName?: string | null;
};

/**
 * A short message someone can cook from: title, serves and time, ingredients, steps and notes,
 * then the credit and the Håfa link. No rules, cost, tags, nutrition or personal notes.
 */
export function formatRecipeShareText(
  recipe: Pick<Recipe, 'extracted' | 'source_url' | 'source_type'>,
  { servings, link, contributorName }: RecipeShareTextOptions = {},
): string {
  const { extracted } = recipe;
  const original = typeof extracted.servings === 'number' && extracted.servings > 0 ? extracted.servings : null;
  const target = original && servings && servings > 0 ? servings : original;
  const scaleFactor = original && target ? target / original : 1;
  const lines: string[] = [extracted.title.trim() || 'Recipe'];

  const facts: string[] = [];
  if (target) facts.push(target === original ? `Serves ${target}` : `Serves ${target} (scaled from ${original})`);
  const total = extracted.times?.total?.trim();
  if (total) facts.push(total);
  if (facts.length) lines.push(facts.join(' · '));

  const components = extracted.components.filter(component => component.ingredients.length || component.steps.length);
  const named = components.length > 1;
  let estimated = false;

  if (components.some(component => component.ingredients.length)) lines.push('', 'Ingredients');
  components.forEach((component, index) => {
    if (!component.ingredients.length) return;
    if (named && component.name?.trim()) lines.push(...(index > 0 ? [''] : []), component.name.trim());
    for (const ingredient of component.ingredients) {
      const line = formatShareIngredient(ingredient, scaleFactor);
      estimated ||= line.startsWith('≈');
      lines.push(`• ${line}`);
    }
  });

  const steps = components.flatMap(component => component.steps.map(step => step.trim()).filter(Boolean)
    .map((step, index) => ({ step, heading: named && index === 0 ? component.name?.trim() : '' })));
  if (steps.length) {
    lines.push('', 'Steps');
    steps.forEach(({ step, heading }, index) => {
      if (heading) lines.push(...(index > 0 ? [''] : []), heading);
      lines.push(`${index + 1}. ${step}`);
    });
  }

  const notes = getCookingNotes(extracted.notes);
  if (notes) lines.push('', `Notes: ${notes}`);

  const footer: string[] = [];
  if (estimated) footer.push('≈ amount estimated by Håfa');
  const source = getSourceCredit(recipe.source_url, recipe.source_type);
  if (source) footer.push(`Original: ${source.url}${source.handle ? ` (by ${source.handle})` : ''}`);
  if (contributorName?.trim()) footer.push(`Recipe by ${contributorName.trim()} on Håfa`);
  footer.push(link ? `Open it in Håfa Recipes: ${link}` : 'Shared from Håfa Recipes');
  lines.push('', ...footer);
  return lines.join('\n');
}

/** The one-line caption under the preview card. */
export function getShareFootnote(mode: RecipeShareMode, { linkActive, contributorName }: { linkActive?: boolean; contributorName?: string | null } = {}): string {
  switch (mode) {
    case 'public':
      return contributorName ? `Recipe by ${contributorName} in Discover. Anyone with the link can open it.` : 'Public in Discover. Anyone with the link can open it.';
    case 'private':
      return linkActive ? 'Anyone with this link can open it. It won’t appear in Discover.' : 'Private. Only you can open it until you send a link.';
    case 'under-review':
      return 'Under review. Links won’t open for others right now, but you can still send it as text.';
    case 'text-only':
      return 'This recipe isn’t public, so you can send it as text.';
  }
}

/** "Link active · created Nov 16" (the year appears once it isn't this year). */
export function formatLinkCreated(createdAt: string | null | undefined, now = new Date()): string {
  const date = createdAt ? new Date(createdAt) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Link active';
  const sameYear = date.getFullYear() === now.getFullYear();
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return `Link active · created ${label}`;
}

/** `error`: the status check failed, so whether a link exists is unknown (never read it as "no link"). */
export type RecipeLinkState = { loading: boolean; unavailable: boolean; error?: boolean; active: boolean; url: string | null };

/** What the sheet offers: one primary action, then the rows that make sense for this recipe. */
export function getShareSheetModel(mode: RecipeShareMode, link: RecipeLinkState) {
  const canLink = mode === 'public' || (mode === 'private' && !link.unavailable);
  return {
    primary: canLink ? 'send-link' as const : 'send-text' as const,
    showCopyLink: canLink,
    showLinkStatus: mode === 'private' && link.active && !link.unavailable,
  };
}

/**
 * Before sending or copying a private recipe's link: use the link kept on this phone, confirm the first
 * link, or confirm a replacement when the current link isn't on this phone (the API never shows it twice).
 */
export function resolveLinkRequest(mode: RecipeShareMode, recipeId: string, link: RecipeLinkState):
  { kind: 'ready'; url: string } | { kind: 'confirm-create' } | { kind: 'confirm-replace' } | { kind: 'wait' } | { kind: 'error' } | { kind: 'none' } {
  if (mode === 'public') return { kind: 'ready', url: publicRecipeLink(recipeId) };
  if (mode !== 'private' || link.unavailable) return { kind: 'none' };
  if (link.loading) return { kind: 'wait' };
  // Creating a link here would replace one the family may already have; wait for a known status.
  if (link.error) return { kind: 'error' };
  if (link.active && link.url) return { kind: 'ready', url: link.url };
  return link.active ? { kind: 'confirm-replace' } : { kind: 'confirm-create' };
}

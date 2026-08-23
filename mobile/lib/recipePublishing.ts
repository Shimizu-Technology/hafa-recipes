import type { Recipe } from '@/types/recipe';

export const PUBLISHING_DISCLOSURE_VERSION = 1;

export const PUBLISHING_DISCLOSURE_MESSAGE =
  'Public recipes can appear in Discover and search. People can see the recipe title, ingredients, instructions, recipe notes, photo, source link, and your contributor name. Personal notes and extraction details stay private. You can make a recipe private later.';

export interface PublishingDisclosureStatus {
  current_version: number;
  accepted_version: number;
  requires_acceptance: boolean;
}

export interface PublishDisclosure {
  title: string;
  ingredientCount: number;
  instructionCount: number;
  hasPhoto: boolean;
  hasSourceLink: boolean;
  contributorName: string;
}

export function getPublishDisclosure(recipe: Recipe): PublishDisclosure {
  const components = recipe.extracted.components || [];
  return {
    title: recipe.extracted.title || 'Untitled recipe',
    ingredientCount: components.reduce((count, component) => count + component.ingredients.length, 0),
    instructionCount: components.reduce((count, component) => count + component.steps.length, 0),
    hasPhoto: Boolean(recipe.thumbnail_url),
    hasSourceLink: Boolean(recipe.source_url && !recipe.source_url.startsWith('manual://')),
    contributorName: recipe.extractor_display_name || 'your contributor name',
  };
}

export function formatPublishDisclosure(disclosure: PublishDisclosure): string {
  const visible = [
    `“${disclosure.title}”`,
    `${disclosure.ingredientCount} ingredient${disclosure.ingredientCount === 1 ? '' : 's'}`,
    `${disclosure.instructionCount} instruction${disclosure.instructionCount === 1 ? '' : 's'}`,
    disclosure.hasPhoto ? 'the recipe photo' : null,
    disclosure.hasSourceLink ? 'the original source link' : null,
    `attribution to ${disclosure.contributorName}`,
  ].filter(Boolean);

  return `People in the shared library will see ${visible.join(', ')}. Recipe notes are public; your personal notes and extraction details stay private.`;
}

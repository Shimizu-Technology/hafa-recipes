import type { Recipe } from '@/types/recipe';

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

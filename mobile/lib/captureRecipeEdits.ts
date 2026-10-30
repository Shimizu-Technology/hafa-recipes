import type { api } from './api';
/** Preserve evidence and nested components while applying the canonical editor snapshot. */
export function applyCaptureEdits(extracted: any, data: Parameters<typeof api.editRecipe>[1]) {
  return { ...extracted, title: data.title, servings: data.servings, components: data.components,
    notes: data.notes, tags: data.tags, times: { ...extracted.times, prep: data.prep_time, cook: data.cook_time, total: data.total_time },
    nutrition: { ...extracted.nutrition, perServing: data.nutrition, total: data.nutrition_total,
      servingBasis: data.nutrition_serving_basis, assumptions: data.nutrition_assumptions } };
}

import { describe, expect, it } from 'vitest';
import { applyCaptureEdits } from './captureRecipeEdits';
it('keeps component structure, notes and extraction evidence through a corrected save-only request', () => {
  const components = [1, 2, 3].map(i => ({ name: `Part ${i}`, notes: `Note ${i}`, ingredients: [{ name: 'Rice', quantity: null, notes: 'Rinse' }], steps: [`Cook part ${i}`] }));
  const original = { title: 'Family rice', components, notes: 'Original note', warnings: ['Amount unknown'], evidence: { source: 'photo' } };
  const edited = applyCaptureEdits(original, { title: 'Family rice corrected', components, notes: original.notes, servings: 6 } as any);
  expect(edited.components).toEqual(components);
  expect(edited.notes).toBe(original.notes);
  expect(edited.warnings).toEqual(original.warnings);
  expect(edited.evidence).toEqual(original.evidence);
  expect(edited.title).toBe('Family rice corrected');
});

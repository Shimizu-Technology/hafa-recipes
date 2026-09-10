/** Save a completed capture without asking the cook to certify every field.
 * A failed save keeps the extracted payload available for a save-only retry.
 */
export interface CapturedRecipeSaveInput {
  extracted: any;
  source_type: 'photo' | 'text';
  is_public: boolean;
}

export async function saveCaptureOrRecover(
  input: CapturedRecipeSaveInput,
  location: string,
  save: (input: CapturedRecipeSaveInput) => Promise<{ id: string }>,
) {
  try {
    const result = await save(input);
    if (!result?.id) throw new Error('Recipe save did not return an ID');
    return `/recipe/${result.id}` as const;
  } catch {
    return {
      pathname: '/ocr-review' as const,
      params: {
        recipe: JSON.stringify(input.extracted),
        location,
        isPublic: input.is_public ? 'true' : 'false',
        sourceType: input.source_type,
        saveFailed: 'true',
      },
    };
  }
}

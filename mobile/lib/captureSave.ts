import { randomUUID } from 'expo-crypto';
import { getApiErrorMessage } from './apiErrorMessage';

/** Save a completed capture without asking the cook to certify every field.
 * A failed save keeps the extracted payload available for a save-only retry.
 */
export interface CapturedRecipeSaveInput {
  extracted: any;
  source_type: 'photo' | 'text';
  is_public: boolean;
  capture_id?: string;
}

/** Only a rejected payload can safely be edited before reconciling the first save. */
export function captureSaveFailure(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const kind = status === 400 || status === 422 ? 'invalid'
    : status === 401 || status === 403 ? 'auth'
    : status === 409 ? 'conflict' : 'retry';
  const message = kind === 'auth' ? 'Sign in again before retrying this save.'
    : kind === 'invalid' ? getApiErrorMessage(error, 'Some recipe details could not be saved. Edit the recipe to correct them.')
    : kind === 'conflict' ? 'This import was already saved with different details. Check My Recipes for the saved recipe.'
    : getApiErrorMessage(error, 'The connection was interrupted. Your extracted recipe is still here.');
  return { kind, message };
}

export async function saveCaptureOrRecover(
  input: CapturedRecipeSaveInput,
  location: string,
  save: (input: CapturedRecipeSaveInput) => Promise<{ id: string }>,
) {
  const request = { ...input, capture_id: input.capture_id ?? randomUUID() };
  try {
    const result = await save(request);
    if (!result?.id) throw new Error('Recipe save did not return an ID');
    return `/recipe/${result.id}` as const;
  } catch (error) {
    const failure = captureSaveFailure(error);
    return {
      pathname: '/ocr-review' as const,
      params: {
        recipe: JSON.stringify(input.extracted),
        location,
        isPublic: input.is_public ? 'true' : 'false',
        sourceType: input.source_type,
        saveFailed: 'true',
        captureId: request.capture_id,
        saveErrorKind: failure.kind,
        saveErrorMessage: failure.message,
      },
    };
  }
}

import { privateRecipeDrafts } from './privateRecipeDrafts';
import { CaptureAccountChangedError } from './captureAccount';
export { CaptureAccountChangedError } from './captureAccount';
import type { RecipeImageUpload } from './api';
import { randomUUID } from 'expo-crypto';
import { captureSaveFailure } from './captureSaveFailure';
export { captureSaveFailure } from './captureSaveFailure';

/** Save a completed capture without asking the cook to certify every field.
 * A failed save keeps the extracted payload available for a save-only retry.
 */
export interface CapturedRecipeSaveInput {
  extracted: any;
  source_type: 'photo' | 'text';
  is_public: boolean;
  capture_id?: string;
  original_pages?: RecipeImageUpload[];
  expected_owner_id?: string;
  requestGuard?: () => void;
}


export async function saveCaptureOrRecover(
  input: CapturedRecipeSaveInput,
  location: string,
  save: (input: CapturedRecipeSaveInput) => Promise<{ id: string }>,
) {
  const request = { ...input, capture_id: input.capture_id ?? randomUUID() };
  // Persist the exact recipe/page request before the first server write. A
  // process loss between recipe save and page upload must resume the same ID.
  if (input.original_pages?.length && input.expected_owner_id) {
    input.requestGuard?.();
    await privateRecipeDrafts.write(privateRecipeDrafts.lease(input.expected_owner_id), 'recovery', {
      captureId: request.capture_id, failure: { kind: 'retry', message: 'Saving was interrupted. Reconnect to finish saving.' },
      request: { capture_id: request.capture_id, extracted: input.extracted, source_type: input.source_type, is_public: input.is_public, original_pages: input.original_pages },
      recipe: { id: request.capture_id, extracted: input.extracted, source_type: input.source_type, is_public: input.is_public },
    });
    input.requestGuard?.();
  }
  try {
    const result = await save(request);
    if (!result?.id) throw new Error('Recipe save did not return an ID');
    input.requestGuard?.();
    if (input.expected_owner_id) {
      const lease = privateRecipeDrafts.lease(input.expected_owner_id);
      await privateRecipeDrafts.remove(lease, 'recovery').catch(() => undefined);
      await privateRecipeDrafts.remove(lease, input.source_type === 'text' ? 'paste' : 'scan').catch(() => undefined);
    }
    return `/recipe/${result.id}` as const;
  } catch (error) {
    if (error instanceof CaptureAccountChangedError) throw error;
    const failure = captureSaveFailure(error);
    input.requestGuard?.();
    let draftStorageError: string | undefined;
    if (input.expected_owner_id) await privateRecipeDrafts.write(privateRecipeDrafts.lease(input.expected_owner_id), 'recovery', {
      captureId: request.capture_id, failure, request: { capture_id: request.capture_id, extracted: input.extracted, source_type: input.source_type, is_public: input.is_public, original_pages: input.original_pages }, recipe: { id: request.capture_id, extracted: input.extracted, source_type: input.source_type, is_public: input.is_public },
    }).catch(() => { draftStorageError = 'This recipe is still open, but its local draft could not be written. Keep Håfa open until you save it.'; });
    return {
      pathname: '/ocr-review' as const,
      params: {
        recipe: JSON.stringify(input.extracted),
        location,
        isPublic: input.is_public ? 'true' : 'false',
        sourceType: input.source_type,
        saveFailed: 'true',
        captureId: request.capture_id,
        ...(input.original_pages?.length ? { originalPages: JSON.stringify(input.original_pages) } : {}),
        ...(input.expected_owner_id ? { captureOwnerId: input.expected_owner_id } : {}),
        saveErrorKind: failure.kind,
        saveErrorMessage: failure.message,
        ...(draftStorageError ? { draftStorageError } : {}),
      },
    };
  }
}

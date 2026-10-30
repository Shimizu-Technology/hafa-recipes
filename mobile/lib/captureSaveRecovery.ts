import { privateRecipeDrafts } from './privateRecipeDrafts';
import { captureSaveFailure } from './captureSaveFailure';
import type { CapturedRecipeSaveInput } from './captureSave';

/** Keep the exact failed manual capture, including its ordered private pages. */
export async function recoverFailedCaptureSave(error: unknown, request: CapturedRecipeSaveInput,
  capture: { ownerId: string; recipe: any }, guard: () => void, leave: () => Promise<void>) {
  guard(); await leave(); guard();
  const failure = captureSaveFailure(error);
  await privateRecipeDrafts.write(privateRecipeDrafts.lease(capture.ownerId), 'recovery', {
    request, recipe: { ...capture.recipe, extracted: request.extracted, is_public: request.is_public, source_type: request.source_type },
    captureId: request.capture_id, failure,
  });
  guard();
  return { pathname: '/ocr-review' as const, params: {
    originalPages: JSON.stringify(request.original_pages), recipe: JSON.stringify(request.extracted), captureId: request.capture_id,
    captureOwnerId: capture.ownerId, sourceType: request.source_type, saveFailed: 'true', saveErrorKind: failure.kind,
    saveErrorMessage: failure.message, isPublic: request.is_public ? 'true' : 'false',
    ...(failure.savedRecipeId ? { savedRecipeId: failure.savedRecipeId } : {}),
  } };
}

import type { OCRExtractionResult } from './api';

export type ImageImportFailurePresentation = {
  title: string;
  message: string;
  offersManualEntry: boolean;
};

export type ManualImageDraftRoute = {
  pathname: '/add-recipe';
  params: {
    captureSource: 'photo';
    fromOcr: 'true';
    initialImageUri: string;
  };
};

/** Carry a failed image import into a private, manually editable recipe draft. */
export function getManualImageDraftRoute(imageUri?: string): ManualImageDraftRoute | null {
  const normalizedUri = imageUri?.trim();
  if (!normalizedUri) return null;

  return {
    pathname: '/add-recipe',
    params: {
      captureSource: 'photo',
      fromOcr: 'true',
      initialImageUri: normalizedUri,
    },
  };
}

/** Present classified image failures without implying that a dish photo is a recipe. */
export function getImageImportFailurePresentation(
  result: OCRExtractionResult,
): ImageImportFailurePresentation {
  const fallback = result.error
    || 'Could not extract a recipe from these images. Try clearer recipe pages.';
  switch (result.error_code) {
    case 'IMAGE_DISH_PHOTO':
      return {
        title: 'Recipe Text Needed',
        message: fallback,
        offersManualEntry: true,
      };
    case 'IMAGE_UNREADABLE':
      return {
        title: 'Recipe Text Is Unclear',
        message: fallback,
        offersManualEntry: true,
      };
    case 'IMAGE_UNSUPPORTED':
      return {
        title: 'Choose One Recipe',
        message: fallback,
        offersManualEntry: true,
      };
    case 'IMAGE_CLASSIFICATION_UNAVAILABLE':
      return {
        title: 'Could Not Verify Images',
        message: fallback,
        offersManualEntry: true,
      };
    default:
      return {
        title: 'Extraction Failed',
        message: fallback,
        offersManualEntry: false,
      };
  }
}

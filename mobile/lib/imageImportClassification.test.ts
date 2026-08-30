import { describe, expect, it } from 'vitest';

import {
  getImageImportFailurePresentation,
  getManualImageDraftRoute,
} from './imageImportClassification';

describe('image import classification failures', () => {
  it('does not describe a dish photo as an extracted recipe', () => {
    expect(getImageImportFailurePresentation({
      success: false,
      error_code: 'IMAGE_DISH_PHOTO',
      error: 'This looks like a food photo, not a recipe document.',
    })).toEqual({
      title: 'Recipe Text Needed',
      message: 'This looks like a food photo, not a recipe document.',
      offersManualEntry: true,
    });
  });

  it('keeps ordinary provider failures on the existing retry path', () => {
    expect(getImageImportFailurePresentation({
      success: false,
      error: 'Provider unavailable',
    })).toEqual({
      title: 'Extraction Failed',
      message: 'Provider unavailable',
      offersManualEntry: false,
    });
  });

  it('carries the selected image into a manually editable photo draft', () => {
    expect(getManualImageDraftRoute(' file:///recipe-card.jpg ')).toEqual({
      pathname: '/add-recipe',
      params: {
        captureSource: 'photo',
        fromOcr: 'true',
        initialImageUri: 'file:///recipe-card.jpg',
      },
    });
    expect(getManualImageDraftRoute()).toBeNull();
  });
});

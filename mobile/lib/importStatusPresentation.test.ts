import { describe, expect, it } from 'vitest';
import { getImportStatusPresentation } from './importStatusPresentation';
const status = { isExtracting: false, isComplete: true, isFailed: false, progress: 100,
  currentStep: 'complete', message: 'Recipe saved' };
describe('truthful import completion', () => {
  it('never infers public visibility before the saved recipe is loaded', () => {
    expect(getImportStatusPresentation(status).description).toBe('Saved to your library');
    expect(getImportStatusPresentation(status, { is_public: false }).description).toBe('Private recipe');
    expect(getImportStatusPresentation(status, { is_public: true }).description).toBe('Public in Discover');
  });
  it('explains incomplete drafts and moderation holds without claiming Discover access', () => {
    expect(getImportStatusPresentation(status, { is_public: false, review_state: 'source_incomplete' }))
      .toMatchObject({ title: 'Draft saved', description: 'Private draft · Add missing details before publishing.' });
    expect(getImportStatusPresentation(status, { is_public: true, moderation_status: 'hidden' }).description)
      .toBe('Public · Hidden from Discover while under review');
  });
  it('distinguishes cancellation, expiry, lost connection and automatic retry', () => {
    expect(getImportStatusPresentation({ ...status, isFailed: true, terminalStatus: 'cancelled' }).title).toBe('Import cancelled');
    expect(getImportStatusPresentation({ ...status, isFailed: true, terminalStatus: 'expired' }).title).toBe('Import expired');
    expect(getImportStatusPresentation({ ...status, isComplete: false, isExtracting: true, connectionNotice: 'Reconnecting' }).description).toBe('Reconnecting');
    expect(getImportStatusPresentation({ ...status, isComplete: false, isRetrying: true }).title).toBe('Import retrying');
  });
  it('keeps accessible progress finite and bounded', () => {
    for (const [value, expected] of [[Infinity, 0], [-10, 0], [150, 100]])
      expect(getImportStatusPresentation({ ...status, progress: value }).progress).toBe(expected);
  });
});

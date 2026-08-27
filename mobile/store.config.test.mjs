import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  APP_DESCRIPTION,
  APP_STORE_ID,
  APP_SUBTITLE,
  PROMO_TEXT,
  RELEASE_NOTES,
  buildStoreConfig,
} = require('./store.config.js')._testing;
const environment = {
  APP_REVIEW_EMAIL: 'reviewer@example.com',
  APP_REVIEW_PASSWORD: 'a-secure-review-password',
  APP_REVIEW_CONTACT_EMAIL: 'owner@example.com',
  APP_REVIEW_CONTACT_PHONE: '+16715550123',
};
const listing = {
  trackId: Number(APP_STORE_ID),
  trackName: 'Håfa Recipes',
  description: 'The original App Store description remains unchanged.',
};

describe('App Store release metadata', () => {
  it('publishes the reviewed listing and requires a controlled phased release', () => {
    const config = buildStoreConfig({ environment, listing });
    const info = config.apple.info['en-US'];

    expect(config.apple.version).toBe('2.6.0');
    expect(config.apple.release).toEqual({ automaticRelease: false, phasedRelease: true });
    expect(info.subtitle).toBe(APP_SUBTITLE);
    expect(info.description).toBe(APP_DESCRIPTION);
    expect(info.description).not.toMatch(/\bbeta\b/i);
    expect(info.promoText).toBe(PROMO_TEXT);
    expect(info.privacyPolicyUrl).toBe('https://hafa-recipes.com/privacy');
    expect(info.supportUrl).toBe('https://hafa-recipes.com/support');
    expect(info.releaseNotes).toBe(RELEASE_NOTES);
    expect(config.apple.review.demoRequired).toBe(true);
    expect(config.apple.review.demoUsername).toBe(environment.APP_REVIEW_EMAIL);
    expect(config.apple.review.notes).toContain('does not provide persistent background audio');
    expect(config.apple.advisory).toBeUndefined();
  });

  it('refuses another app, a missing description, or missing reviewer credentials', () => {
    expect(() => buildStoreConfig({
      environment,
      listing: { ...listing, trackId: 123 },
    })).toThrow('different App Store application');
    expect(() => buildStoreConfig({
      environment,
      listing: { ...listing, description: '' },
    })).toThrow('description must be available for verification');
    expect(() => buildStoreConfig({
      environment: { ...environment, APP_REVIEW_PASSWORD: '' },
      listing,
    })).toThrow('APP_REVIEW_PASSWORD');
  });

  it('rejects weak reviewer passwords and incomplete review contact information', () => {
    expect(() => buildStoreConfig({
      environment: { ...environment, APP_REVIEW_PASSWORD: 'short' },
      listing,
    })).toThrow('at least 12 characters');
    expect(() => buildStoreConfig({
      environment: { ...environment, APP_REVIEW_CONTACT_PHONE: '' },
      listing,
    })).toThrow('APP_REVIEW_CONTACT_PHONE');
  });

  it('keeps listing text within App Store limits', () => {
    expect(APP_SUBTITLE.length).toBeLessThanOrEqual(30);
    expect(PROMO_TEXT.length).toBeLessThanOrEqual(170);
    expect(APP_DESCRIPTION.length).toBeGreaterThanOrEqual(10);
    expect(APP_DESCRIPTION.length).toBeLessThanOrEqual(4000);
    expect(RELEASE_NOTES.length).toBeLessThanOrEqual(4000);
  });
});

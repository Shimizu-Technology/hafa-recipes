import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { APP_STORE_ID, buildStoreConfig } = require('./store.config.js')._testing;
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
  it('preserves the public description and requires a controlled phased release', () => {
    const config = buildStoreConfig({ environment, listing });

    expect(config.apple.version).toBe('2.5.3');
    expect(config.apple.release).toEqual({ automaticRelease: false, phasedRelease: true });
    expect(config.apple.info['en-US'].description).toBe(listing.description);
    expect(config.apple.info['en-US'].privacyPolicyUrl).toBe('https://hafa-recipes.com/privacy');
    expect(config.apple.info['en-US'].supportUrl).toBe('https://hafa-recipes.com/support');
    expect(config.apple.review.demoRequired).toBe(true);
    expect(config.apple.review.demoUsername).toBe(environment.APP_REVIEW_EMAIL);
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
    })).toThrow('description must be preserved');
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

  it('removes the exact obsolete beta announcement while preserving the rest of the listing', () => {
    const description = [
      'Transform cooking videos into detailed recipes.',
      '',
      'BETA - FREE DURING BETA',
      "All features free while we're in beta. Paid plans coming soon to cover AI costs.",
      '',
      'Your existing features and descriptions remain unchanged.',
    ].join('\n');

    const config = buildStoreConfig({ environment, listing: { ...listing, description } });

    expect(config.apple.info['en-US'].description).toBe([
      'Transform cooking videos into detailed recipes.',
      '',
      'Your existing features and descriptions remain unchanged.',
    ].join('\n'));
    expect(config.apple.info['en-US'].description).not.toMatch(/\bbeta\b/i);
  });

  it('requires explicit review instead of guessing how to rewrite another beta claim', () => {
    expect(() => buildStoreConfig({
      environment,
      listing: { ...listing, description: 'A separate beta feature is still under development.' },
    })).toThrow('unreviewed beta claim');
  });
});

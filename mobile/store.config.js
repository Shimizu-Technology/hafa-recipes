const https = require('node:https');

const app = require('./app.json').expo;
const APP_STORE_ID = '6755892896';
const MAX_LISTING_BYTES = 1_000_000;
const RELEASE_NOTES =
  'Import recipes from pasted text, screenshots, and native shares. Enjoy one-tap source video playback, clearer grocery and meal-plan links, and a refreshed reef-inspired design. Ask Håfa now has more reliable context, streaming responses, image paste and attachments, voice dictation, spoken answers, drafts, privacy protections, and clearer recovery when something goes wrong.';
const LEGACY_BETA_NOTICE =
  /^BETA - FREE DURING BETA\r?\nAll features free while we're in beta\. Paid plans coming soon to cover AI costs\.\r?\n(?:\r?\n)?/m;

function requiredEnvironmentValue(environment, name) {
  const value = String(environment[name] ?? '').trim();
  if (!value) throw new Error(`Set ${name} before preparing App Store metadata`);
  return value;
}

function fetchCurrentListing() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      `https://itunes.apple.com/lookup?id=${APP_STORE_ID}`,
      { timeout: 10_000 },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Could not read the existing App Store listing (${response.statusCode})`));
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_LISTING_BYTES) {
            request.destroy(new Error('The existing App Store listing was unexpectedly large'));
          }
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            const listing = JSON.parse(body).results?.find(
              (candidate) => String(candidate.trackId) === APP_STORE_ID,
            );
            if (!listing?.description?.trim() || listing.trackName !== app.name) {
              throw new Error('The current Håfa Recipes listing could not be verified');
            }
            resolve(listing);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('App Store listing lookup timed out')));
    request.on('error', reject);
  });
}

function buildStoreConfig({ environment, listing }) {
  if (String(listing?.trackId) !== APP_STORE_ID || listing.trackName !== app.name) {
    throw new Error('Refusing to prepare metadata for a different App Store application');
  }
  if (typeof listing.description !== 'string' || listing.description.trim().length < 10) {
    throw new Error('The current App Store description must be preserved');
  }
  const description = listing.description.replace(LEGACY_BETA_NOTICE, '');
  if (/\bbeta\b/i.test(description)) {
    throw new Error('The production App Store description still contains an unreviewed beta claim');
  }

  const reviewerEmail = requiredEnvironmentValue(environment, 'APP_REVIEW_EMAIL');
  const reviewerPassword = requiredEnvironmentValue(environment, 'APP_REVIEW_PASSWORD');
  if (reviewerPassword.length < 12) {
    throw new Error('APP_REVIEW_PASSWORD must be at least 12 characters');
  }

  return {
    configVersion: 0,
    apple: {
      version: app.version,
      copyright: `${new Date().getFullYear()} Shimizu Technology`,
      release: {
        automaticRelease: false,
        phasedRelease: true,
      },
      info: {
        'en-US': {
          title: app.name,
          description,
          releaseNotes: RELEASE_NOTES,
          marketingUrl: 'https://hafa-recipes.com',
          privacyPolicyUrl: 'https://hafa-recipes.com/privacy',
          supportUrl: 'https://hafa-recipes.com/support',
        },
      },
      review: {
        firstName: String(environment.APP_REVIEW_CONTACT_FIRST_NAME ?? 'Leon').trim(),
        lastName: String(environment.APP_REVIEW_CONTACT_LAST_NAME ?? 'Shimizu').trim(),
        email: requiredEnvironmentValue(environment, 'APP_REVIEW_CONTACT_EMAIL'),
        phone: requiredEnvironmentValue(environment, 'APP_REVIEW_CONTACT_PHONE'),
        demoUsername: reviewerEmail,
        demoPassword: reviewerPassword,
        demoRequired: true,
        notes: 'Use the provided email and password on the Sign In screen. The Discover tab is available without an account. Grocery lists, meal planning, recipe creation, and the interactive home-screen widget require the review account.',
      },
    },
  };
}

async function loadStoreConfig() {
  const listing = await fetchCurrentListing();
  return buildStoreConfig({ environment: process.env, listing });
}

loadStoreConfig._testing = {
  APP_STORE_ID,
  LEGACY_BETA_NOTICE,
  RELEASE_NOTES,
  buildStoreConfig,
  requiredEnvironmentValue,
};

module.exports = loadStoreConfig;

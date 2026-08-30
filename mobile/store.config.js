const https = require('node:https');

const app = require('./app.json').expo;
const APP_STORE_ID = '6755892896';
const MAX_LISTING_BYTES = 1_000_000;
const APP_SUBTITLE = 'AI Recipe Import & Planner';
const PROMO_TEXT =
  'Turn cooking videos, links, pasted text, and screenshots into organized recipes—then plan meals, shop, and cook in one place.';
const APP_DESCRIPTION = `Save the recipes you find online and turn them into something you can actually cook.

Håfa Recipes imports cooking videos, recipe websites, pasted captions and messages, screenshots, photos, and recipes shared from other apps. It organizes ingredients, steps, servings, nutrition, costs, and source links in one connected recipe library.

IMPORT RECIPES YOUR WAY
• Share TikTok, Instagram, YouTube, and recipe links
• Paste recipe text from captions, comments, messages, or websites
• Scan screenshots, printed recipe cards, and cookbook pages
• Add and edit family recipes manually
• Keep a link to the original source and play supported source videos in the app

PLAN, SHOP, AND COOK
• Save recipes to custom collections
• Add recipes to a weekly meal plan
• Build grocery lists from one recipe or an entire week
• See which recipe each grocery item came from
• Share grocery lists with family
• Adjust servings, ingredients, nutrition, and estimated cost
• Follow large, step-by-step cook mode with timers and spoken instructions

GET HELP WHEN YOU NEED IT
• Ask Håfa for substitutions, techniques, timing, and recipe questions
• Type, dictate, or attach images in chat
• Get answers that stay connected to the recipe you are viewing
• Find recipes based on ingredients you already have

DISCOVER AND ORGANIZE
• Browse community recipes without signing in
• Search by recipe, ingredient, or contributor
• Find related recipes and move between connected recipes, meal plans, and grocery items
• Choose light, dark, or system appearance

AI can make mistakes. Review extracted ingredients, directions, allergens, temperatures, and food-safety guidance before cooking.

Made in Guam by Shimizu Technology.`;
const RELEASE_NOTES =
  'Recipe imports are now easier to verify and fix. Håfa calls out missing amounts instead of guessing, shows when a recipe needs review, keeps incomplete imports private, and lets you save source drafts to finish manually. Website, caption, slideshow, and video extraction are more careful about unsupported details, with a clearer path back to the original. This update also includes pasted-text, screenshot, photo, and native-share imports; improved grocery and meal-plan connections; and more reliable Ask Håfa chat, image, voice, and draft recovery.';

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
    throw new Error('The current App Store description must be available for verification');
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
          subtitle: APP_SUBTITLE,
          description: APP_DESCRIPTION,
          releaseNotes: RELEASE_NOTES,
          promoText: PROMO_TEXT,
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
        notes: 'Use the provided email and password on the Sign In screen. The Discover tab and public recipe details are available without an account. Grocery lists, meal planning, recipe creation, Ask Håfa, and the interactive home-screen widget require the review account. The app does not provide persistent background audio. Audio is limited to foreground source-video playback, cook-mode narration, and timer sounds; timer completion while the app is backgrounded uses a local notification.',
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
  APP_DESCRIPTION,
  APP_SUBTITLE,
  PROMO_TEXT,
  RELEASE_NOTES,
  buildStoreConfig,
  requiredEnvironmentValue,
};

module.exports = loadStoreConfig;

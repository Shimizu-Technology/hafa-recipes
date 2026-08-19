# Recipe Extractor

React Native app that transforms cooking videos, recipe websites, and recipe photos into structured recipes using AI.

**Supported Sources:** TikTok, YouTube, Instagram, recipe websites, handwritten/printed recipe cards

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Add your Clerk key

# Start Expo dev server
npx expo start

# Checks
npm run typecheck
npm run doctor
```

Scan QR with Expo Go, or press `i` for iOS simulator.

## Environment Variables

```bash
# Clerk Auth (required)
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
EXPO_PUBLIC_CLERK_ENVIRONMENT=development
EXPO_PUBLIC_API_BASE_URL=https://recipe-api-x5na.onrender.com

# Sentry Error Monitoring (optional but recommended for production)
EXPO_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

For production builds, set these in **Expo Dashboard → Environment variables**.

`EXPO_PUBLIC_CLERK_ENVIRONMENT` is a release safety check. It must be
`development` for the bridge release and `production` for the final Clerk
cutover release; the app also verifies that it matches the `pk_test_` or
`pk_live_` publishable-key prefix.

## API Configuration

- **Development:** Auto-detects your machine's IP, or uses
  `EXPO_PUBLIC_API_BASE_URL` when explicitly set
- **Production:** Uses `https://recipe-api-x5na.onrender.com`

## Features

### Core
- **Extract from Video** - Paste a video URL, get a structured recipe
- **Scan Recipe Card** - Take a photo of handwritten/printed recipes (OCR)
  - Multi-image support for multi-page recipes
  - Review & edit before saving
- **My Recipes** - Personal collection with search & filter
- **Discover** - Browse public recipes from all users
- **Save/Bookmark** - Save others' recipes to your collection

### AI-Powered
- **Video Extraction** - OpenAI extracts structured recipes from cooking videos
- **Photo OCR** - OpenAI vision reads handwritten and printed recipes
- **Recipe Chat** - Ask questions and get substitutions or scaling tips
- **Auto Tags** - AI-suggested tags for manual recipes
- **Nutrition Estimation** - AI estimates nutrition for manual recipes

### Organization
- **Collections** - Group recipes into custom folders
- **Grocery List** - Add ingredients, check off while shopping
  - Items grouped by recipe with collapsible sections
  - "Other Items" section for manual additions
  - Collapse state persists between sessions
- **Meal Planner** - Plan your weekly meals
  - Add recipes to Breakfast, Lunch, Dinner, Snack slots
  - Browse My Recipes, Saved, or Discover to add meals
  - Quick filters by cook time and tags
  - Add entire week's ingredients to grocery list
  - Navigate between weeks
- **Search** - Find by title, tags, or ingredients

### Editing
- **Edit Recipes** - Modify any recipe you own
- **Re-extract** - Re-run AI extraction with latest model (owners & admins)
- **Version History** - View all changes, restore any previous version
- **Restore Original** - Revert to original AI extraction
- **Personal Notes** - Add private notes to your recipes
- **Manual Entry** - Add your own recipes with photo upload

### Cook Mode
- **Step-by-Step View** - Focus on one step at a time with large text
- **Screen Stays On** - No more tapping to keep the screen awake
- **Built-in Timers** - Auto-detects times in steps, tap to start
  - Pause, resume, reset, stop controls
  - Vibration alert when timer completes
- **Ingredients Reference** - Quick slide-up view of all ingredients
- **Swipe Navigation** - Swipe or tap to move between steps
- **Completion State** - Clear finish screen when you complete the recipe

## Project Structure

```
app/                    # Expo Router screens
├── (auth)/             # Sign-in, sign-up
├── (tabs)/             # Main tab navigation
│   ├── index.tsx       # Extract tab (video URL, OCR, manual)
│   ├── history.tsx     # My Recipes
│   ├── discover.tsx    # Public recipes
│   ├── planner.tsx     # Meal planner (weekly view)
│   ├── grocery.tsx     # Grocery list
│   └── settings.tsx    # Settings & profile
├── recipe/[id].tsx     # Recipe detail
├── cook-mode/[id].tsx  # Step-by-step cooking view
├── ocr-review.tsx      # OCR extraction review
├── add-recipe.tsx      # Manual recipe entry
└── _layout.tsx         # Root layout + auth

components/             # Reusable UI
├── Themed.tsx          # Theme-aware components
├── RecipeCard.tsx      # Recipe list item
├── ExtractionProgress.tsx
├── AddIngredientsModal.tsx
└── ...

hooks/                  # React Query hooks
├── useRecipes.ts       # Recipe CRUD + extraction
├── useGrocery.ts       # Grocery list
├── useCollections.ts   # Collections
└── useMealPlan.ts      # Meal planning

lib/
├── api.ts              # API client (axios)
└── auth.ts             # Clerk helpers
```

## Building for Production

### iOS (App Store)

```bash
# Build
eas build --platform ios --profile production

# Submit to TestFlight
eas submit --platform ios --latest
```

### Android (Play Store)

```bash
eas build --platform android --profile production
eas submit --platform android --latest
```

## Tech Stack

- **Framework:** React Native + Expo
- **Navigation:** Expo Router (file-based)
- **State:** React Query (TanStack Query)
- **Auth:** Clerk (Apple, Google, Email)
- **Error Monitoring:** Sentry (crash reporting, performance tracking)
- **Animations:** react-native-reanimated
- **UI:** Custom themed components

## Related

- **Backend API:** [recipe-api](https://github.com/Shimizu-Technology/recipe-api)
- **Changelog:** See [CHANGELOG.md](./CHANGELOG.md)
- **Roadmap:** See [ROADMAP.md](./ROADMAP.md)

## License

Private - Shimizu Technology

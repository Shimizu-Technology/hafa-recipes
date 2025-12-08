# Recipe Extractor

React Native app that transforms cooking videos into structured recipes using AI.

**Supported Platforms:** TikTok, YouTube, Instagram

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Add your Clerk key

# Start Expo dev server
npx expo start
```

Scan QR with Expo Go, or press `i` for iOS simulator.

## Environment Variables

```bash
# Clerk Auth (required)
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
```

For production builds, set this in **Expo Dashboard → Environment variables**.

## API Configuration

Edit `lib/api.ts`:

```typescript
const USE_LOCAL_API = true;  // false for production
```

- **Development:** Auto-detects your machine's IP
- **Production:** Uses `https://recipe-api-x5na.onrender.com`

## Features

### Core
- **Extract Recipes** - Paste a video URL, get a structured recipe
- **My Recipes** - Personal collection with search & filter
- **Discover** - Browse public recipes from all users
- **Save/Bookmark** - Save others' recipes to your collection

### AI-Powered
- **Smart Extraction** - Gemini 2.0 Flash extracts ingredients, steps, nutrition, costs
- **Recipe Chat** - Ask questions, get substitutions, scaling tips (GPT-4o)
- **Auto Tags** - AI-suggested tags for manual recipes
- **Nutrition Estimation** - AI estimates nutrition for manual recipes

### Organization
- **Collections** - Group recipes into custom folders
- **Grocery List** - Add ingredients, check off while shopping
  - Items grouped by recipe with collapsible sections
  - "Other Items" section for manual additions
  - Collapse state persists between sessions
- **Search** - Find by title, tags, or ingredients

### Editing
- **Edit Recipes** - Modify any recipe you own
- **Re-extract** - Re-run AI extraction with latest model (owners & admins)
- **Version History** - View all changes, restore any previous version
- **Restore Original** - Revert to original AI extraction
- **Personal Notes** - Add private notes to your recipes
- **Manual Entry** - Add your own recipes with photo upload

## Project Structure

```
app/                    # Expo Router screens
├── (auth)/             # Sign-in, sign-up
├── (tabs)/             # Main tab navigation
│   ├── index.tsx       # Extract tab (home)
│   ├── recipes.tsx     # My Recipes
│   ├── discover.tsx    # Public recipes
│   ├── grocery.tsx     # Grocery list
│   └── settings.tsx    # Settings & profile
├── recipe/[id].tsx     # Recipe detail
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
└── useCollections.ts   # Collections

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
- **Animations:** react-native-reanimated
- **UI:** Custom themed components

## Related

- **Backend API:** [recipe-api](https://github.com/Shimizu-Technology/recipe-api)
- **Changelog:** See [CHANGELOG.md](./CHANGELOG.md)
- **Roadmap:** See [ROADMAP.md](./ROADMAP.md)

## License

Private - Shimizu Technology


# Changelog

All notable changes to Recipe Extractor.

## [1.1.1] - December 2025

### Added
- **Re-extract Recipes** - Re-run AI extraction with the latest model (owners + admins)
- **Skeleton Loading** - Smooth app startup with skeleton UI instead of blank splash
- **Animated Progress** - Extraction progress animates smoothly
- **Optimistic Updates** - Grocery list feels instant when deleting items
- **Admin Support** - Admins can re-extract any recipe via Clerk metadata

### Improved
- **Network Resilience** - Token retry logic for slow connections
- **Polling Stability** - Graceful handling of network failures during extraction

### Fixed
- Grocery modal $0 cost display bug
- Nutrition values now properly rounded to integers

### Backend
- Switched to Gemini 2.0 Flash for extraction (~40% faster, ~80% cheaper)
- Added GPT-4o-mini fallback if Gemini fails
- New async re-extraction endpoint

---

## [1.1.0] - December 2025

### Added
- **Search & Filter** - Find recipes by title, tags, ingredients
- **Collections** - Organize recipes into custom folders
- **Manual Recipe Entry** - Add your own recipes with photo upload
- **Recipe Editing** - Edit any recipe, restore original version
- **Save Public Recipes** - Bookmark recipes from Discover
- **AI Tag Suggestions** - Auto-suggest tags for manual recipes
- **AI Nutrition** - Estimate nutrition for manual recipes
- **Infinite Scroll** - Smooth pagination in lists
- **Haptic Feedback** - Tactile responses throughout

### Improved
- Animation polish across the app
- Recipe card design refresh

---

## [1.0.0] - November 2025

### Initial Release
- Extract recipes from TikTok, YouTube, Instagram
- AI-powered transcription (Whisper) and extraction (GPT-4o-mini)
- Grocery list with recipe ingredients
- AI Recipe Chat (GPT-4o)
- Cost estimation by location
- Nutrition information
- Apple, Google, and Email sign-in
- Public recipe sharing (Discover)


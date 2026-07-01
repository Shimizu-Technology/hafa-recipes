# Changelog

All notable changes to Recipe Extractor.

## [2.3.0] - July 2026

### Added
- **Håfa Recipes brand refresh** with a new island-modern palette, app icon, splash artwork, and brand mark.
- **Signed-out previews** for Discover and Meal Planner so new users can understand the app before creating an account.
- **Public Discover browsing for guests** with save actions still gated behind sign-in.

### Improved
- Default Discover view is now the visual grid layout.
- Extract screen copy now clearly supports TikTok, YouTube, Instagram, recipe websites, OCR scans, and manual family recipes.
- Website extraction guidance now includes a support email when a recipe site does not import cleanly.
- Typography updated to DM Sans and Fraunces for a warmer editorial recipe feel.
- Emoji UI was replaced with Ionicons and brand assets throughout the app.

### Fixed
- App icon now uses a full-bleed background so iOS no longer shows dark corners around the icon mask.
- Discover now shows a real API error state instead of looking like an empty community library when loading fails.

---

## [1.2.0] - December 2025

### Added
- **Photo-to-Recipe (OCR)** - Scan handwritten or printed recipe cards
  - Camera capture or select from photo library
  - Multi-image support for multi-page recipes (up to 10)
  - AI reads and structures your recipes
  - Review and edit screen before saving
- **Personal Notes** - Add private notes to any recipe you own
- **Version History** - View all changes to a recipe, restore any version
- **Grocery Grouping** - Items grouped by recipe with collapsible sections
- **Re-extract Recipes** - Re-run AI extraction with the latest model (owners + admins)
- **Skeleton Loading** - Smooth app startup with skeleton UI instead of blank splash
- **Animated Progress** - Extraction progress animates smoothly
- **Admin Support** - Admins can re-extract any recipe via Clerk metadata
- **Consolidated Extract Tab** - Video, OCR, and Manual entry all in one place

### Improved
- **40% Faster Extraction** - Switched to Gemini 2.0 Flash (~80% cheaper too)
- **Detailed Change Summaries** - Version history shows exactly what changed
- **Higher Quality Photos** - 95% quality capture, no forced square crop
- **Page Ordering** - Multi-page recipes maintain correct step order
- **Network Resilience** - Token retry logic for slow connections
- **Polling Stability** - Graceful handling of network failures during extraction
- **Optimistic Updates** - Grocery list feels instant when deleting items

### Fixed
- Grocery modal $0 cost display bug
- Nutrition values now properly rounded to integers
- Admin re-extraction permissions (JWT template fix)

### Backend
- Gemini 2.0 Flash for video extraction (GPT-4o-mini fallback)
- Gemini 2.0 Flash Vision for OCR (GPT-4o Vision fallback)
- New OCR endpoints (single + multi-image)
- Personal notes and version history APIs
- Async re-extraction endpoint

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

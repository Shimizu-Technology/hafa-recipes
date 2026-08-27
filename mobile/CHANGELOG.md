# Changelog

All notable changes to Recipe Extractor.

## [Unreleased]

## [2.6.0] - August 2026

### Added
- Import complete recipes from pasted captions, messages, and other copied text.
- Import multi-image recipes from screenshots, camera photos, and native shares.
- Play supported TikTok, Instagram, YouTube, and source videos inside the app.
- Paste text or images directly into Ask Håfa, dictate questions, and hear answers
  read aloud.

### Improved
- Refreshed the app with a reef-first color system, updated icon and splash art,
  clearer navigation, stronger accessibility, and better signed-out previews.
- Made recipe collections, meal-plan dates, notes, source videos, and grocery
  relationships more compact and directly connected in both directions.
- Improved grocery search, grouping, shopping actions, and recipe attribution.
- Made What Can I Make? pantry matches clearer and easier to turn into grocery
  actions.
- Redesigned Ask Håfa with a labeled entry point, recipe return links, streamed
  answers, cancellation, local drafts, clearer assistant identity, and better
  retry states.

### Privacy and reliability
- Scoped chat history and image cleanup to the stable application account so one
  signed-in user cannot inherit another user's local conversation.
- Limited chat diagnostics to operational facts and excluded prompts, answers,
  recipes, images, URLs, account IDs, and storage keys.
- Improved chat context selection so incomplete or failed turns do not poison the
  next request, while keeping enough recent conversation to answer follow-ups.

## [2.5.3] - August 2026

### Improved
- Production builds now fail closed unless they use the Clerk production
  environment and a matching live publishable key.
- Updated Expo SDK 57 packages to the current compatible patch set.

### Operations
- Added a privacy-safe aggregate bridge-adoption report and recorded the
  production-key TestFlight acceptance gates.

## [2.5.0] - August 2026

### Added
- Added private recipe/contributor reporting and reversible contributor blocking
  to the recipe options menu.
- Added a Safety Center for blocked contributors, report and appeal status, and
  account moderation appeals.
- Added owner-only recipe hold notices with a direct appeal path.

### Improved
- Manual and photo recipes no longer expose unusable internal source links;
  sharing them sends the complete recipe directly.
- Development and preview builds now show their environment and API host and
  cannot silently fall back to production services.
- Migrated sign-in infrastructure to Clerk Core 3 and timer/TTS playback to
  Expo Audio while preserving the existing user flows.
- Updated chat Markdown rendering and restricted assistant links to safe web
  protocols.

### Developer experience
- Added one-command isolated local setup with PostgreSQL and synthetic seed data.
- Added blocking Expo health and reviewed production-dependency audit gates.

## [2.4.0] - August 2026

### Improved
- Added the invisible first half of the Clerk production migration so signed-in
  users can retain their session and recipe library through the follow-up
  authentication cutover.
- Added an explicit release guard that prevents development and production
  Clerk credentials from being mixed accidentally.
- Centralized local and production API selection for safer release testing.

### Security
- Migration credentials are installation-scoped, stored only in SecureStore,
  and never written to logs, analytics, URLs, or crash reports.
- Deliberate sign-out now opts the installation out of automatic migration.

---

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

## [2.2.1] - February 2026

### Fixed
- Collection selection and add-to-collection reliability.
- Android build/runtime compatibility issues in the release configuration.
- Auth screen and floating action UI polish.

---

## [2.2.0] - January 2026

### Added
- Floating timer overlay for active cooking timers across the app.
- Floating cooking assistant entry point for quick recipe questions.
- Bulk add-to-collection flow.
- Text size preferences for more comfortable reading.

### Improved
- Discover filters, history, grocery, settings, edit recipe, and OCR review flows.
- Collection and recipe chat handling.

---

## [2.1.2] - January 2026

### Fixed
- Timer sound asset names for Android compatibility.
- Cook mode timer behavior and recipe chat presentation.
- Supporting API/client updates for recipe flows.

---

## [2.1.0] - January 2026

### Added
- Background timer notifications for cook mode.

### Fixed
- Grocery list reliability and offline cache fallback behavior.
- Timer restore, cancellation, and background handling.

---

## [2.0.0] - December 2025

### Added
- Shared grocery list invites and grocery list settings.
- Share intent handling for incoming recipe links.
- Timer sound preferences and text-to-speech support.
- Scaled servings controls and supporting recipe utilities.
- Contributor browsing improvements for Discover.

### Improved
- Major refreshes across Discover, History, Grocery, Settings, Recipe Detail, Cook Mode, and extraction progress.
- Network/offline handling and skeleton loading states.

---

## [1.4.0] - December 2025

### Added
- **What Can I Make?** ingredient-based recipe search.
- Top Contributors and contributor filtering in Discover.
- Website recipe import with structured-data parsing and AI fallback.
- Custom timers in Cook Mode.
- Voice input for AI recipe chat.
- Meal type tagging during extraction.

### Improved
- Discover sorting, server-side search, search result counts, and source/time/tag filters.
- Grocery recipe-section clearing and recipe attribution display.

---

## [1.3.0] - December 2025

### Added
- Forgot password flow.
- Profile editing for recipe attribution.
- Offline/network status banner and improved connectivity handling.
- Sentry error monitoring integration.
- Theme preference context.

### Improved
- Auth screens, settings, collections, grocery, planner, and Discover polish.

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

# Roadmap

Planned features and improvements for Recipe Extractor.

---

## 🚀 Up Next (v1.3.0)

### 🐛 Bug Fixes (Priority)
- [ ] Delete recipe not refreshing list
- [ ] Search loading indicator missing

### 🔧 UX Improvements
- [ ] Optimistic updates audit
- [ ] Recipe attribution on Discover (who extracted, when)
- [ ] Filter own recipes from Discover
- [ ] Dark/Light mode toggle

### 📱 Platform Expansion
- [ ] Android deployment (Google Play Store)

### 📶 Offline Support
- [ ] Offline grocery list (Tier 1 - use while shopping!)
- [ ] Offline My Recipes (Tier 2)

### 🍽️ New Features
- [ ] Meal Plan Generator (AI-powered weekly planning)
- [ ] Fork recipe (copy & edit saved recipes)

### 🧪 Quality
- [ ] Unit tests for backend
- [ ] E2E tests for mobile
- [ ] AI extraction evals

---

## 📸 Future Features

### iOS Home Screen Widget
- [ ] Grocery list count widget
- [ ] Recent recipes widget
- [ ] Requires native Swift development

### AI Chat → Recipe Updates
- [ ] Chat suggestions can update the recipe directly
- [ ] "Make this dairy-free" → AI modifies ingredients
- [ ] Creates a new version (preserves original)

### Share Extension
- [ ] Share from TikTok/YouTube/Instagram directly to app
- [ ] No need to copy/paste URLs
- [ ] Auto-starts extraction

---

## 💡 Ideas (Backlog)

### Social Features
- [ ] Follow other users
- [ ] Activity feed
- [ ] Recipe ratings/reviews

### Organization
- [ ] Advanced filters (prep time, servings, calories)
- [ ] Batch extraction (multiple URLs)
- [ ] Recipe deduplication

### Export
- [ ] Export as PDF (printable recipe cards)
- [ ] Export as image (Instagram story style)
- [ ] Backup/restore all recipes as JSON

### Integrations
- [ ] Siri Shortcuts ("Add chicken to my grocery list")
- [ ] Apple Watch grocery list
- [ ] Grocery delivery service integration

### Monetization
- [ ] Clerk + Stripe billing
- [ ] Free tier with monthly limits
- [ ] Premium tier for power users

---

## ✅ Recently Completed

### v1.2.0
- [x] **Photo-to-Recipe (OCR)** - Scan handwritten/printed recipes
  - Camera + gallery image selection
  - Multi-image support (up to 10 pages)
  - Page ordering for multi-page recipes
  - Review & edit before saving
  - Gemini 2.0 Flash Vision + GPT-4o Vision fallback
  - High-quality capture (95%, no forced crop)
- [x] Personal notes on any recipe (private to you)
- [x] Version tracking (view history, restore any version)
- [x] Detailed change summaries (see exactly what changed)
- [x] Grocery list grouped by recipe (collapsible sections)
- [x] "Other Items" section for non-recipe grocery items
- [x] Collapse state persists via AsyncStorage
- [x] Consolidated Extract tab (Video, OCR, Manual entry)
- [x] Re-extract recipes with latest AI (owners + admins)
- [x] Admin role support (via Clerk public metadata)
- [x] Skeleton loading UI (replaces blank splash)
- [x] Smooth animated extraction progress
- [x] Network resilience improvements
- [x] Optimistic grocery updates
- [x] 40% faster extraction (Gemini 2.0 Flash)

### v1.1.0
- [x] Search & filter
- [x] Collections
- [x] Manual recipe entry
- [x] Recipe editing
- [x] Save public recipes
- [x] AI tags & nutrition
- [x] Recipe scaling

### v1.0.0
- [x] Video extraction (TikTok, YouTube, Instagram)
- [x] AI transcription & extraction
- [x] Grocery list
- [x] AI recipe chat
- [x] Cost & nutrition info
- [x] Public sharing (Discover)

---

*Last updated: December 2025*


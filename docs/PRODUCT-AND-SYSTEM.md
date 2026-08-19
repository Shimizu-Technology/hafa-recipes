# Håfa Recipes: Product and System Overview

Status: active production product
Product class: public, consumer, AI-assisted mobile application
Primary business goal: sustainable recurring or passive income
Primary market identity: a Guam-rooted capture-to-cook recipe product

## Product purpose

Håfa Recipes solves a fragmented-recipe problem. People discover recipes in TikTok, Instagram, YouTube, recipe websites, screenshots, cookbooks, handwritten cards, and family notes. Those sources are difficult to search, plan from, shop from, and follow while cooking.

The product turns that scattered inspiration into a usable cooking workflow:

```text
Capture -> Extract -> Review -> Organize -> Plan -> Shop -> Cook -> Improve
```

The app should be judged by whether a user can move through that workflow reliably, not by the number of AI features it contains.

## Why it was built this way

The product began as a Next.js application. It was migrated to React Native and FastAPI to gain:

- native App Store and Google Play distribution;
- a native share-sheet capture flow;
- camera and photo-library access for family recipes;
- notifications, timers, speech, and Cook Mode behavior;
- a mobile-first experience while preserving the existing Neon dataset.

The migration explicitly preserved 266 existing recipes. The legacy Next.js application remains in the archived standalone history and is not an active product surface.

## Core users and jobs

### Recipe collector

Wants to save a recipe before it disappears in a feed and retrieve it later.

Success means:

- capture takes only a few actions;
- extraction completes reliably;
- uncertain fields are easy to review;
- the saved recipe is searchable and organized.

### Household cook

Wants to turn saved recipes into a weekly plan, grocery list, and calm cooking experience.

Success means:

- servings and ingredients remain consistent;
- groceries aggregate correctly;
- Cook Mode is readable and timer behavior is dependable;
- offline or interrupted use does not lose progress.

### Family recipe keeper

Wants to preserve handwritten or printed recipes without accidentally publishing personal family content.

Success means:

- OCR supports multiple pages;
- manual corrections preserve recipe sections;
- scanned and manual recipes are private by default;
- the user understands any later publishing action.

### Discover user

Wants inspiration from public recipes without signing in immediately.

Success means:

- Discover is fast and useful;
- public content contains only intentionally published fields;
- saving or contributing has a clear sign-in transition;
- inappropriate content can be reported and contributors can be blocked.

### Product operator / moderator

Wants to keep public content trustworthy and resolve operational problems without editing production data directly.

Success means:

- reports and stuck extraction jobs are visible in one place;
- content can be hidden, restored, featured, or corrected through safe domain actions;
- destructive actions are exceptional and confirmed;
- every administrative action records who acted, what changed, why, and when.

## Product positioning

The strongest positioning is not “an AI recipe app.” Recipe extraction, scanning, meal planning, and shopping lists are increasingly common.

The stronger promise is:

> Håfa Recipes turns recipes from anywhere into something you can confidently plan, shop, and cook.

The brand should emphasize:

- Guam roots and a welcoming Håfa identity;
- family recipes alongside modern social recipes;
- practical trust and correction rather than magical AI claims;
- an end-to-end cooking workflow;
- warm, editorial, island-modern visual design.

## Product principles

1. **Trust before novelty.** A clearly uncertain measurement is better than a confident wrong one.
2. **Private until intentionally published.** Family recipes and personal notes should not become public by accident.
3. **One canonical recipe structure.** Editing, scaling, grocery creation, nutrition, and Cook Mode must use the same data model.
4. **The share sheet is the front door.** Capturing from another app should be the fastest path into Håfa Recipes.
5. **AI is replaceable infrastructure.** Model names belong in configuration and provenance, not the brand promise.
6. **Derived data must identify itself.** Nutrition and cost should show that they are estimates, how they were calculated, and when they are stale.
7. **Core workflow before social breadth.** Reliability and household collaboration have priority over follows, comments, and engagement mechanics.
8. **Accessibility is product quality.** Extracting and cooking must work with screen readers, text scaling, reduced motion, and reachable touch targets.
9. **Administration is a product surface, not a database console.** Operators receive a small set of authorized, reversible actions with an audit trail.

## Active surfaces

| Surface | Location | Responsibility |
|---|---|---|
| Mobile app | `mobile/` | Expo/React Native consumer app, authentication, capture, library, Discover, planner, grocery, Cook Mode, chat |
| API | `api/` | FastAPI business logic, extraction, authorization, recipes, jobs, grocery sharing, collections, meal plans, AI calls |
| Database | Neon PostgreSQL | Users' recipe data, public recipes, jobs, lists, collections, plans, versions |
| Object storage | AWS S3 | Recipe thumbnails and chat images |
| Authentication | Clerk | Apple, Google, and email identity; JWTs and admin metadata |
| AI providers | OpenAI | Structured extraction, vision, transcription, chat, nutrition/tags, speech |
| Marketing site | `web/` | Product explanation, acquisition, privacy, support, app download |
| Admin portal (target) | `admin/` | Protected web moderation, curation, extraction operations, and audit history |
| Legacy app | Archived standalone history | Deprecated historical implementation; not an active product target |

## Current architecture

```text
TikTok / Instagram / YouTube / website / photo / manual form
                              |
                              v
                   Expo React Native app
                              |
                    Clerk bearer token
                              |
                              v
                        FastAPI API
                  /           |           \
             yt-dlp      website parser    OCR images
                  \           |           /
                   transcript / source text
                              |
                              v
                     AI model router
                              |
                   structured recipe JSON
                              |
                 +------------+------------+
                 |                         |
                 v                         v
          Neon PostgreSQL                AWS S3
                 |
                 v
 Library / Discover / Planner / Grocery / Cook Mode / Chat
```

The target admin path is a separate lightweight web interface calling backend-enforced `/api/admin/*` actions. It should use Clerk authentication and an admin claim, but authorization must be enforced by FastAPI on every request. The consumer mobile bundle should not contain the moderation experience, and the legacy Next.js app should not be revived for it.

## Environment strategy

Håfa Recipes does not require a continuously deployed staging application at its current scale. The supported environments are:

- local/development, using local services or a disposable non-production database;
- production, selected explicitly through release configuration.

Preview builds may exist, but each must explicitly declare which backend it uses. Development must never fall back silently to production, and routine contributor or intern work must not require production database credentials. This is a safety boundary, not a requirement to maintain a staging product.

## Canonical data expectations

The canonical recipe should contain:

- title and source attribution;
- servings and time values;
- one or more named components;
- ingredients within components;
- steps within components;
- equipment and notes;
- media references;
- visibility and ownership;
- extraction provenance and confidence.

The following are derived and must be recalculable or invalidated after canonical recipe edits:

- nutrition;
- estimated cost;
- meal-type tags;
- search tags;
- total-minute cache;
- grocery quantities generated from servings.

Raw transcripts, AI prompts, private extraction notes, provider errors, Clerk IDs, and internal debug metadata are not public recipe fields.

## Target navigation direction

The active six-tab navigation gives every capability equal weight and becomes crowded on phones. The target direction is:

- Home
- Recipes
- Plan
- Shop

Capture/extraction should remain the prominent primary action and share-sheet destination. Discover belongs within Recipes, while Settings belongs behind the user profile.

This navigation change is a product-design task, not part of the immediate production-safety release.

## Success measures

The product needs a privacy-conscious analytics baseline before feature prioritization or monetization decisions.

### Activation

- sign-up to first import started;
- first import success rate;
- time from import start to reviewed recipe;
- percentage of new users who save or cook a recipe.

### Reliability and AI quality

- success rate by source and platform;
- fallback rate by model;
- schema-validation failure rate;
- median and p95 extraction latency;
- user correction rate by field;
- cost per successful extraction;
- stuck or retried job rate.

### Retention and value

- D1, D7, and D30 retention;
- recipes captured per active user;
- grocery, planner, and Cook Mode adoption;
- recipes cooked or revisited;
- household/shared-list usage.

Recipe content, full URLs, transcripts, and personal notes must not be included in analytics events.

## Near-term non-goals

- a broad social network;
- comments and ratings before moderation exists;
- RAG for a single recipe that already fits in model context;
- precise calorie recognition from a food photograph;
- expensive media vendors without measured need;
- model marketing as product differentiation.
- a general-purpose admin database browser or arbitrary record editor.

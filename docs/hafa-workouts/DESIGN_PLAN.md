# Håfa Workouts: logo, styling and feel

**Owner:** Leon · **Written:** 2026-10-13 · **Source reviewed:** `origin/main` at `d43ef6d`

The goal is for Håfa Workouts to look like it belongs next to Håfa Recipes,
feel modern and easy to use mid-workout, and have a logo that reads as
"Håfa" and "fitness" at a glance.

Related: [ROADMAP.md](ROADMAP.md). Build the Discover tab in the new design.

## Collection-first experience (2026-10-19)

Leon confirmed that saving social workouts and browsing the shared Discover library are the core product. Planning, tracking and coaching are optional follow-through. Use Recipes as the reference for clear media identity, readable content and quiet secondary controls, keeping Workouts' existing brand tokens.

Acceptance: recognize the same cover and creator from feed to saved detail; browse and save without a training profile; keep filtering, collections and recovery available with fewer controls above the content. Phone layouts favor readable cards; wider screens use two columns and large text returns to one. Image failures keep an understandable fallback. Existing press feedback stays immediate, with its reduced-motion alternative; layout changes introduce no entrance delays.

## Decisions (D1, 2026-10-13)

Leon delegated the D1 choices ("whatever is clean and nice"). These are now in effect:

| Question | Decision |
|---|---|
| Logo | **Concept A, latte-stone barbell.** The tåsa cap is the bar, with sunrise-coral plates on each end and the halagi pillar below. |
| Accent | **Sunrise coral** `#E8643C`, used for graphics, rings and the active tab. Text uses `#AD401C` on light and `#F07A52` on dark so it passes AA. Reef green `#155C52` stays the action colour. |
| Light/dark | Follow the system setting. Light (cream) is the primary design. |
| Voice | Warm and plain, with an occasional "Håfa adai". No body-transformation or clinical claims. |

**Why A.** All three concepts were drawn on the Recipes icon grid (1024 canvas, 380px halo, 94px tåsa cap, same pillar curve) and rendered at 256, 180, 60 and 29px in light, dark and mono ([logo-concepts.png](design/logo-concepts.png); per concept: [A](design/logo-concept-A.png), [B](design/logo-concept-B.png), [C](design/logo-concept-C.png)).
- At 29px and in the single-colour (tinted or themed) icon, **A is the only one that reads instantly as fitness**. The barbell silhouette survives, and the cap and pillar still read as a latte stone.
- **C** (kettlebell) was simplest. But its monochrome silhouette reads as a padlock or lantern at small sizes, even after widening the handle.
- **B**'s motion arcs turn to noise below 60px, and the tilted stone looks like a hammer.
- A also mirrors Recipes' structure, where something sits on the latte stone (bowl → barbell). It reuses the same reef, deep-reef and cream values, so the two icons look like siblings on a home screen.

**Source of truth.** All assets are generated from `workouts-mobile/scripts/brand-geometry.mjs` by `node workouts-mobile/scripts/render-brand.mjs` (needs `rsvg-convert` and ImageMagick). That covers the iOS light, dark and tinted icons, the Android adaptive foreground and monochrome icons, the light and dark splash, the website mark, favicons, apple-touch icon and OG image, and the in-app `components/brand-mark-shapes.ts`. Concept sheets: `node workouts-mobile/scripts/render-brand.mjs --concepts`.

**Tokens.** `workouts-mobile/constants/theme.ts` is the only file allowed to hold raw colours. `lib/theme.test.ts` enforces this and also checks:
- WCAG contrast for every pair the components render;
- parity with `mobile/constants/Colors.ts` (shared Håfa values);
- parity with the website CSS variables, the app config and the icon palettes.

## Where it stands today

### Logo
| Place | What it is now | Problem |
|---|---|---|
| App icon (`workouts-mobile/assets/icon.svg`) | Lime "H" with uneven uprights and a white dot, on near-black green `#172820` | Reads as a lopsided letter, not fitness. It has no visual link to Recipes. |
| Website mark (`workouts-web/public/mark.svg`) | A lime "W" zig-zag on forest green | It's a **different logo** from the app icon. |
| In-app header (`components/ui.tsx`) | Plain text "HÅFA WORKOUTS" | There's no mark at all. |
| Recipes, for comparison (`mobile/assets/brand/hafa-recipes-icon.svg`) | A **latte stone** (halagi pillar and tåsa cap) carrying a steaming bowl, on cream, in reef green and clay | It's a strong, local and recognisable idea. Workouts should build on it. |

### Color and type
- Fonts: both apps use **DM Sans**. Keep it.
- **Palettes:**

  | App | Palette (`file`) | Style |
  |---|---|---|
  | Recipes | Cream `#FFF7EC`, reef `#155C52`, clay `#B94722` (`mobile/constants/Colors.ts`) | warm and "island-modern" |
  | Workouts | Bone `#F6F3EC`, forest `#225B45`, lime `#C1DA80` (`components/ui.tsx`) | cooler and greener |

  So the two apps don't read as one family, even though Leon asked that "people should know they're connected".
- Colors are defined inline in `ui.tsx` (no theme file).
- Screens hard-code hex values. For example, the hero card uses `#225B45`, `#DDEBCB` and `#E1EDD9` in `app/(tabs)/index.tsx`, so dark mode and future changes miss them.
- `workouts-web/src/styles.css` repeats the palette by hand.

### Feel
- **Screens are mostly text and stacked full-width buttons.** For example, Today shows "Log activity I completed" and "Talk through today with my coach" as two big buttons under a generic "Make time for you." headline.
- **Imagery:** there are almost no images. Source thumbnails appear only on capture and import (`components/source-image.tsx`), while Recipes uses cover images everywhere. Discover will need image-led cards.
- **Icons:** stock Ionicons outlines everywhere. The tab icons are sunny, albums, calendar and chart.
- **Motion and feedback:** no `expo-haptics`, no `react-native-reanimated` and no `expo-image` in `workouts-mobile`. Nothing confirms a completed set, and lists have no loading skeletons.
- **Good foundations to keep:**
  - 48–56pt touch targets;
  - accessible roles and labels on the shared primitives;
  - light and dark palettes;
  - a 660px max content width.

## Design direction (proposed; Leon to confirm in D1)

**One Håfa family, two personalities.**

- **Shared across Håfa apps:**
  - the latte-stone motif;
  - DM Sans;
  - the warm neutrals (cream, bone, ink);
  - reef green as the "Håfa" anchor;
  - icon construction (same canvas, padding and stroke weights);
  - account and "Håfa apps" UI.
- **Workouts' own personality:** a more energetic accent and a bolder, sportier rhythm with numbers front and centre. Recipes is calm and warm; Workouts should feel calm but moving.

**Accent options for D1** (pick one; the hex values are starting points and must pass contrast):
1. **Sunrise coral** (around `#E8643C`): energy, sunrise runs, and a close relative of Recipes' clay.
2. **Lagoon blue** (around `#1F7FA8`): ocean and Guam water, and cooler.
3. **Banana / latte gold** (around `#E9A83A`): bright and optimistic. It needs a dark text pairing.

Recommended: **reef green as primary, sunrise coral as the Workouts accent**. It reads as the same family and still feels like movement.

**Logo concepts for D1** (produce all three, then pick one):
- **A. Latte-stone barbell.** The tåsa cap of the latte stone becomes a barbell with plates on each end. It mirrors the Recipes icon, where the bowl sits on the stone.
- **B. Latte stone in motion.** The latte-stone silhouette with two or three motion arcs, echoing the Recipes steam lines but sweeping sideways.
- **C. Latte-stone kettlebell.** The tåsa doubles as a kettlebell handle and the halagi pillar becomes the bell body. This is the simplest shape at small sizes.

All concepts:
- on the cream background, like Recipes;
- readable at 29pt (iOS settings size) and 16px (favicon);
- free of thin details that disappear in the Android monochrome icon.

---

## Work plan

### D0: Audit (½ day)
- [ ] Screenshot every Workouts screen (41 route files under `workouts-mobile/app`) on an iPhone in light mode, dark mode, and the largest Dynamic Type size. Do the same for the matching Recipes screens.
- [ ] Put them side by side in `docs/hafa-workouts/design/audit/` with notes for each screen: hierarchy, density, too many buttons, empty and error states.
- [ ] Note every hard-coded hex value and one-off style:
  ```sh
  grep -rnoE "#[0-9A-Fa-f]{6}" workouts-mobile/app workouts-mobile/components
  ```

### D1: Brand decisions (1 day, with Leon)
- [ ] Draw logo concepts A, B and C as SVGs on the Recipes icon grid (1024 canvas, same padding).
- [ ] Show each at 1024, 180, 60 and 29 px, in light, dark and monochrome.
- [ ] Show the three accent options applied to Today, a workout card and the training screen (static mockups or a quick Expo screen).
- [ ] Leon picks a logo, an accent and the general feel. Record the decision at the top of this file.

### D2: Logo production (1 day)

Each asset is built from one master SVG in `workouts-mobile/assets/brand/`:

| Asset | Spec | File |
|---|---|---|
| iOS app icon | 1024×1024, no alpha | `assets/icon.png` |
| iOS 18 dark and tinted icons | Use Expo `ios.icon` variants: a dark variant on a dark background and a tinted variant as a monochrome glyph | `assets/icon-dark.png`, `assets/icon-tinted.png` |
| Android adaptive icon | Foreground 1024 with the mark inside the central 66% safe zone; background is a solid brand color | `assets/adaptive-foreground.png`, `backgroundColor` in `app.config.ts` |
| Android themed icon | Single-color glyph | `assets/adaptive-monochrome.png` (set `monochromeImage`) |
| Splash screen | Mark only, about 180pt wide, on cream (light) or ink (dark) | `assets/splash.png` and the `expo-splash-screen` config (add a dark variant) |
| In-app mark | Small horizontal lockup (mark + "Håfa Workouts") for headers and sign-in | `components/brand-mark.tsx` (from `react-native-svg`) |
| Website | Mark, favicon (32/16), apple-touch-icon 180, OG image 1200×630 | `workouts-web/public/` (replace the "W" `mark.svg`) |
| App Store | Icon, plus a screenshot frame style for D7 | — |
| "Håfa apps" area | Recipes and Workouts marks side by side | `app/hafa-apps.tsx` |

- [ ] Optional: tweak the Recipes icon so both share the same canvas and stroke weights. Make no structural changes to the Recipes logo.

### D3: Design tokens (1 day)
- [ ] Create `workouts-mobile/constants/theme.ts`:
  - **brand colors**: shared Håfa neutrals and reef, plus the Workouts accent;
  - **semantic tokens**: background, surface, elevated, text, muted, border, action, onAction, accent, success, warning, error, focus, overlay;
  - **spacing scale**: 4, 8, 12, 16, 24, 32, 48;
  - **radii**: 8 / 14 / 20 / 28 / full;
  - **type scale**: display, title, heading, body, label, small, numeric, using tabular figures for sets, reps, weight and time;
  - **elevation and shadow tokens**;
  - **motion durations**.

  Provide light and dark versions.
- [ ] Every text and background pair must pass WCAG AA (4.5:1 for body text, 3:1 for large text and icons). Add a unit test that checks the contrast ratios.
- [ ] Move the palette out of `components/ui.tsx` into the theme. Replace all hard-coded hex values in screens with tokens.
- [ ] Add a lint or test rule that fails on raw hex outside `constants/theme.ts`.
- [ ] Mirror the tokens as CSS variables in `workouts-web/src/styles.css`.
- [ ] Keep the shared Håfa values identical to `mobile/constants/Colors.ts`. Add a small test that compares them, rather than a shared package (the repo intentionally has no JS workspace).

### D4: Components (2–3 days)
Update `components/ui.tsx` and split it into files as it grows.

- [ ] **Button**: primary, secondary, ghost and destructive. Small, medium and large sizes. Icon-only with a required `accessibilityLabel`. Pressed scale and haptic.
- [ ] **Cards**:
  - plain;
  - hero (accent gradient or brand color, not hard-coded);
  - **media card** with a source thumbnail via `expo-image`, title, meta row and chips (for Discover and Library);
  - compact list row.
- [ ] **Chips**: equipment, body area, duration and source platform icon. Selectable variant for filters.
- [ ] **Stat tile and progress ring**: sessions this week, streak (gentle, no guilt), minutes.
- [ ] **Set row** for training: large numerals, a tap to complete, swipe or long-press to edit, and a previous-performance hint.
- [ ] **Rest timer**: a large ring or bar based on real timestamps, with +15s and skip.
- [ ] **Sheets**: bottom sheet for quick actions such as "Not feeling 100%", "Only 15 min" and "Played last night".
- [ ] **Feedback states**: skeleton loaders, empty states (illustration or mark plus one action), error notices, toasts.
- [ ] **Navigation**:
  - tab bar: five tabs with custom or filled-when-active icons and the Workouts accent for the active tab;
  - header with the brand mark on the root tabs.
- [ ] Add `expo-haptics` (light tick on set complete, success on session complete). Add `react-native-reanimated` only if needed, and respect Reduce Motion.

### D5: Screens (4–6 days, in this order)
Each screen gets one clear primary action, fewer stacked buttons, and real content (images, numbers) ahead of explanations.

1. **Today** (`app/(tabs)/index.tsx`):
   - a hero card for today's session: title, duration, equipment and a "Start" button;
   - a quick-adjust chip row: not 100% / 15 min / played last night;
   - this week's strip, showing sessions done and planned;
   - secondary actions (log activity, ask coach) as compact rows rather than full-width buttons;
   - a friendlier, Håfa-voiced greeting, e.g. "Håfa adai, Leon".
2. **Training session** (`app/training.tsx`, `app/session/[id].tsx`):
   - built for one hand while tired;
   - current exercise large, next exercise preview, set rows, rest timer;
   - always-visible finish and pause;
   - a demo or source link that keeps your place.
3. **Capture, import and review** (`app/capture.tsx`, `app/import/[id].tsx`):
   - a progress state while extracting;
   - review as an editable card list;
   - missing details highlighted inline;
   - the public/private toggle.
4. **Discover** (new): a grid or list of media cards, search, filter chips and a detail screen with Save / Plan / Ask coach / Open original.
5. **Library** (`app/(tabs)/library.tsx`): media cards, collections and filters to match Discover.
6. **Workout detail and edit** (`app/workout/`, `app/edit-workout/`, `components/workout-editor.tsx`).
7. **Plan** (`app/(tabs)/plan.tsx`, `build-plan.tsx`, `review-plan.tsx`):
   - a week calendar strip with sport nights shown;
   - drag or tap to move a session;
   - a missed-day banner that shifts the plan.
8. **Progress** (`app/(tabs)/progress.tsx`): consistency first (weeks with sessions), then performance trends. Avoid guilt-style streak messaging.
9. **Coach** (`app/coach.tsx`, `coach-action/`): chat bubbles in brand style, with suggested-change cards that show the change and Accept/Undo.
10. **Onboarding, profile and sign-in**: brand mark, fewer screens, visual equipment picker.
11. **Settings, account, privacy and connections**: tidy list style that matches Recipes settings. The "Håfa apps" area shows both logos.

### D6: Voice and polish (1 day)
- [ ] Copy pass: short, warm, plain English, with an occasional Chamorro touch (Håfa adai, Si Yu'os Ma'åse'). No clinical or "transform your body" claims (see EXPERIENCE.md).
- [ ] Empty-state and success moments, e.g. a session-complete summary card.
- [ ] Check dark mode on every screen.

### D7: Website and store (1–2 days)
- [ ] Restyle `workouts-web` with the new tokens, logo and real app screenshots.
- [ ] Add a link to Recipes (the family relationship).
- [ ] Generate an OG image for shared workout links (`/shared`).
- [ ] App Store screenshots: 6.9" and 6.5", 5–6 frames (Share a video → Extracted workout → Discover → Plan → Train → Progress), in the brand frame style.

### D8: QA and acceptance (1 day)
- [ ] Before/after screenshots for every screen in `docs/hafa-workouts/design/after/`.
- [ ] Checks:
  - contrast test passes;
  - largest Dynamic Type has no clipped text;
  - VoiceOver order on Today, Training and Discover;
  - small-screen check (iPhone SE / 375pt width);
  - Android check when Android ships.
- [ ] Icon check on a real home screen (light, dark and tinted), in Spotlight and in Settings.
- [ ] Leon and his wife use it for a few days and give feedback. Fix the top items.
- [ ] New TestFlight build.

**Done when:**
- Leon likes the icon on his home screen next to Recipes;
- every screen uses tokens, with no raw hex values;
- Today, Training and Discover feel quick to use one-handed;
- both apps clearly look like Håfa.

## How this fits with the roadmap

- D0–D3 run alongside Roadmap Phase 2, so the Discover UI (Phase 3) is built with the new components.
- D4–D5 come before or with the Discover app work. Today and Training first, because they're used daily.
- D7 store screenshots wait until Discover is in.
- Rough total: **about 2–3 weeks of focused work**, with Leon's input at D1 and D8.

## Open questions for Leon (answer at D1)
1. Logo concept A, B or C (or something else)?
2. Accent: sunrise coral, lagoon blue or gold?
3. Should Workouts default to light mode like Recipes, or lean dark for the gym?
4. Any Chamorro words or phrases you want used, or avoided, in the app's voice?

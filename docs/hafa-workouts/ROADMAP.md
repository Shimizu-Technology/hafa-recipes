# Håfa Workouts roadmap

**Owner:** Leon · **Written:** 2026-10-13 · **Source reviewed:** `origin/main` at `d43ef6d`

This is the working plan for finishing Håfa Workouts and the shared Håfa API.
It replaces the earlier milestone documents as the place to look for "what's
next". Older planning documents in this folder are background only.

The visual and brand work has its own plan: [DESIGN_PLAN.md](DESIGN_PLAN.md).

## The goal

> I see a workout video, share it to the app like I do for Recipes, and it
> extracts everything and saves it to a Discover page where everyone can see
> it. Then I can build a plan from my workouts, track my workouts, and ask the
> AI about them.

Why it exists: the workout notes in `Brain-Dump/self/` (a workout dashboard
so Leon doesn't dig through Telegram, two-week training blocks, an athletic
profile, and a Strava history showing "rapid expansion followed by long gaps").
The app should make workouts easy to start and easy to keep doing around
basketball, volleyball, family and work. It should not become another system
to maintain.

## Decisions (2026-10-13)

| Topic | Decision |
|---|---|
| Who uses it now | Leon, his wife, and maybe one more person. Named testers only. |
| Discover | **Public Discover feed, like Recipes.** This replaces the earlier "private libraries only" decision. |
| Instagram | Use the **same Instagram setup as Recipes** (shared cookies/proxy). |
| Health sync | Later, after the small group is using the app. |
| Hosting | Stay on the shared Render Starter service. Upgrade only if memory alerts fire. |
| Old PRs | Close all 20 open PRs; archive the experiment branches under a tag. |
| Process | Small PRs off `main`, no stacked chains, no new test harnesses or process docs without asking Leon. |

## What already exists

Checked in code on `d43ef6d`:

- **Share into the app.** `workouts-mobile` uses `expo-share-intent`, the same as Recipes. It accepts links, text, up to 4 images and PDFs.
- **Extraction.** It reuses the Recipes video pipeline in `api/app/domains/workouts/extraction.py`: audio transcription, sampled frames, captions and TikTok photo posts. It extracts exercises, equipment, sets, reps and rest, and flags missing details.
- **Library, plans, guided training, progress and AI coach.** These are the tabs Today / Library / Plan / Progress, plus `coach.tsx`.
- **Shared Håfa account.** Recipes and Workouts data are kept separate, with opt-in connections.
- **Delivery.** TestFlight 1.0.0 (5) is in Leon's internal group. The API is live on the shared Render service, limited to named testers (`WORKOUTS_TESTER_USER_IDS`).

## What's missing for the goal

1. **Instagram parity.** `api/app/services/video.py` (~line 765) skips the Instagram cookies when the request comes from Workouts. Remove that gate. Keep the log redaction for Workouts URLs.
2. **Public Discover.** Workouts are stored per user (`workouts_library`) and have no public flag. Discover has to be built. See Phase 3.
3. **Missed-day adjustments in the UI.** The backend has a readiness check-in and a shorter-workout action. The app has no "missed session", "not feeling 100%" or "only 15 minutes" flow.

---

## Phase 0: Reset and clean up (~1 day)

- [ ] Close the 20 open PRs (#133–#156). File-by-file comparison:
  - The product PRs (#133, #134, #136, #138, #139, #142, #143, #144, #146, #154) are already in `main` through #155, usually in newer versions.
  - Two Recipes memory PRs are in `main` except for a doc: #137 and #152.
  - The capacity and stress experiments (#140, #141, #145, #147, #149, #150, #153, #156) are parked on purpose.
- [ ] Tag the experiment branches as `archive/capacity-experiments-2026-10`, then delete the remote branches.
- [ ] Turn on GitHub "Automatically delete head branches".
- [ ] Add `.codex/` to `.gitignore`.
- [ ] Prune the worktrees (75 at review time):
  - check the 25 with uncommitted changes before removing anything, especially `hafa-recipes-convenient-*` and `hafa-recipes-capture-idempotency`;
  - remove the merged ones;
  - run `git worktree prune`.
- [ ] Fix Leon's local `main` checkout:
  - move aside the untracked `docs/EXTRACTION-ACCURACY-PLAN.md`;
  - keep the one-line `IMPROVEMENT-ROADMAP.md` edit;
  - pull.
- [ ] Docs:
  - move the older planning docs in this folder into `archive/`;
  - delete `qa-ledger.json`, or replace it with a simple checklist (it shows 0/37 executed and is stale);
  - update the root `README.md`, `AGENTS.md` and `docs/README.md` to mention Workouts and admin.
- [ ] Add to `AGENTS.md`:
  - PRs under ~500 lines of real code;
  - base PRs on `main`;
  - each PR says what the user will notice;
  - ask before adding harnesses, experiments or process docs.

**Done when:** there are no stale PRs, fewer than 10 worktrees, and this file reflects reality.

## Phase 1: Protect the shared server (2–3 days)

Recipes is public on the App Store and shares this server, so this comes first.

- [ ] **Per-user limits on Recipes AI extraction.**
  - Endpoints: `/extract`, `/extract/async`, `/re-extract`, `/extract/text`, `/extract/ocr` and `/extract/ocr/multi` in `api/app/routers/extract.py`.
  - Set hourly and daily limits per user, with a friendly message when a limit is hit.
  - Reuse `ai_rate_limiter`, which chat already uses.
- [ ] **Login-token check that can't stall the server** (`api/app/auth.py`).
  - Run the JWKS lookup in `asyncio.to_thread`.
  - Throttle key refreshes for unknown `kid` values.
- [ ] **Chat images** (`api/app/services/storage.py`).
  - Check whether `chat-images/` in the bucket is publicly readable.
  - Switch to short-lived presigned URLs.
  - Rate-limit `/ai/upload-chat-image`.
- [ ] **Download size caps for Recipes imports** (`services/website.py`, `services/video.py`). Stream with per-file and total caps, the same way Workouts already does.
- [ ] **Admin rights from production only.** Accept the admin role only from the production Clerk issuer.
- [ ] **Install consistency in CI.** Check that `api/requirements.txt` matches `api/uv.lock`.
- [ ] Small items:
  - invalid collection UUIDs return 400, not 500;
  - block the CGNAT range `100.64.0.0/10` (or use `not ip.is_global`);
  - URL-encode the oEmbed `url=` parameter;
  - move the blocking S3 calls off the event loop.

**Done when:** each item is its own merged PR, it's deployed, and the Recipes production health check passes.

## Phase 2: Instagram parity and Workouts bug fixes (2–3 days)

- [ ] Remove the Workouts Instagram-cookie gate in `video.py` (keep log redaction).
- [ ] **Sync queue gets stuck** (`workouts-mobile/lib/training.ts:476-486`). A 404/410 or other permanent error should mark the item for attention and keep syncing the rest. It must not `break` the queue.
- [ ] **Local history grows forever.** Drop synced sessions from device storage after N days or once confirmed on the server. Stop rewriting the whole store on every set tap.
- [ ] **Tabs reload all session history.** Add a `staleTime` and fetch only recent pages for Today, Plan, Progress and Training (`lib/api.ts:227-236`).
- [ ] **Sign-out order** (`app/settings.tsx:19`). Clear the cache only after `signOut()` succeeds.
- [ ] **Corrupt cleanup marker** (`lib/private-device.ts`, `lib/logout-recovery.ts`). Add an in-app reset path instead of "contact support".
- [ ] Add Leon's wife and the third tester to `WORKOUTS_TESTER_USER_IDS`.
- [ ] **Real-phone import test.** Share 10 reels each from Instagram, TikTok and YouTube, plus 5 screenshots and 5 pasted texts. Record the results in `docs/hafa-workouts/import-results.md`: URL type, pass/fail and what was wrong. Fix the top failures.
- [ ] Confirm that AI spend is recorded and that the $5/day cap stops calls.

**Done when:** at least 25 real imports, at least 80% usable with light edits, and no lost sessions.

## Phase 3: Public Discover (4–6 days)

Follow the Recipes model: `is_public`, `moderation_status` and `review_state` on
`recipes`, `app/publishing.py` and `app/moderation.py`.

**Backend**

- [ ] Migration: add to `workouts_library`:
  - `is_public` (default false);
  - `moderation_status` (default `active`);
  - `published_at`;
  - a normalized `source_url` for deduplication.

  Make the migration additive only.
- [ ] Define the public projection: only the creator's prescription. That means title, exercises, sets, reps, rest, equipment, duration, source link and creator credit.
- [ ] Never expose any of these publicly:
  - the user's profile;
  - body measurements;
  - limitations;
  - notes;
  - adapted versions;
  - sessions;
  - health data.

  Add a test that fails if a private field leaks.
- [ ] Publishing rules, the same as Recipes:
  - link imports default to public, while photo, manual and text imports default to private;
  - incomplete extractions are never public;
  - show a one-time publishing notice before the first publish (reuse the disclosure pattern).
- [ ] Endpoints:
  - `GET /api/v1/workouts/discover` with search and filters for equipment, body area, duration and source, paginated;
  - `GET /api/v1/workouts/discover/{id}`;
  - `POST /api/v1/workouts/discover/{id}/save`, which copies the workout into the user's library;
  - publish and unpublish on the owner's workout.
- [ ] Deduplication: if a public workout already exists for the same source video, Discover shows one card. The new import still saves privately for the importer.
- [ ] Moderation: reuse report, hide and block, and the admin dashboard `require_admin` routes. A hidden user's workouts disappear from Discover.
- [ ] Discover reads must work when the Workouts membership is missing. Decide whether Discover is visible to signed-out users (the Recipes behaviour is the reference).

**App**

- [ ] Add a Discover tab: Today · Discover · Library · Plan · Progress. It should be built in the new design system (see DESIGN_PLAN.md).
- [ ] Discover cards: source thumbnail, title, duration, equipment chips and creator credit.
- [ ] Detail screen actions: "Save to my library", "Add to plan", "Ask the coach about this" and "Open original video".
- [ ] Add a public/private toggle on import review and workout detail, with the same wording as Recipes.

**Done when:**
- a reel shared by Leon shows up in Discover for his wife;
- she can save it, plan it and train it;
- nothing personal is visible.

## Phase 4: Use it for two weeks (parallel)

- [ ] Leon sets up his real profile: equipment, weight, knees, sport nights and the one-mile habit.
- [ ] Use Today every day. Log runs and basketball as activities, and log real sets.
- [ ] Build the adjustment flows his notes call for:
  - one-tap "Not feeling 100%", "Only 15 minutes" and "Played last night";
  - a missed day moves the plan forward and never stacks two sessions;
  - connect these to the existing readiness and shorter-workout backend.
- [ ] Keep a friction list and fix the top 5–10 items.

**Done when:** 14 days of real use, most planned sessions done, and Leon would recommend it.

## Phase 5: Recipes app fixes (parallel, 2–3 days)

- [ ] Cook mode resume race (`mobile/app/cook-mode/[id].tsx:329-361`).
- [ ] Cook mode alerts that fire inside state updaters (`:418-478`).
- [ ] Search: debounce and pass the abort `signal` (`mobile/hooks/useRecipes.ts:1302`).
- [ ] Connect React Query `focusManager`/`onlineManager` to AppState and NetInfo.
- [ ] Accessibility labels for cook mode, settings and filters.
- [ ] Confirm the admin app's Clerk token includes `public_metadata.role`.
- [ ] Ship in the next Recipes App Store update.

## Later (when Leon wants it)

- Android build on the Play internal testing track, tested on a real device.
- Apple Health, then Health Connect, tested on physical devices. Store health data encrypted on the phone and set Android `allowBackup: false`. Update the privacy policy.
- Publish the Workouts website.
- Open beyond named testers. Track import success rate, weekly sessions done versus planned, week-4 retention and AI cost per active user.
- Pricing.

## Order of work

```text
Phase 0 ─► Phase 1 ─► Phase 2 ─► Phase 3 (Discover, built in the new design)
                         │            ▲
                         └─ Design D0–D3 (brand, logo, tokens) ┘
Phase 4 (dogfood) runs from Phase 2 onward; Phase 5 slots in whenever.
```

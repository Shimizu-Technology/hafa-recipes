# Håfa Workouts product requirements

Status: proposed complete-release specification incorporating Leon's confirmed decisions. Pending decisions are listed in [the plan index](README.md). These requirements describe intended behavior, not implemented features.

## Purpose and people

Adults collect workout inspiration from social media, websites, documents, and screenshots. Håfa Workouts makes that material searchable and usable, adapts it to the person, organizes it into continuing programs, and records actual training. The intended outcome is a coherent training routine that survives real schedules and interruptions.

Primary users include new exercisers, recreational athletes, home/gym strength trainees, and runners. Experience, available equipment, time, and other activity vary. The product must not assume gym access, constant connectivity, or an interest in body-weight loss.

The primary promise is: turn the workouts you already save into a realistic training routine for your equipment, schedule, and goals. Direct competitors already offer social import and AI planning; trustworthy adaptation and repeatable execution are required product strengths. See [RepReel](https://repreelai.com/), [Curio](https://www.curio.fitness/), and [PeakBFF's draft/import limitations](https://www.peakbff.com/import-workout).

## Complete-release scope

P01 — Account and onboarding. Support Apple, Google, and email sign-in under one Håfa account, subject to provider configuration verification. Existing Recipes users retain their library and ownership. Onboarding explains the relationship between apps, confirms adult eligibility, captures the minimum useful training profile, and allows optional fields to be skipped. Health integration and AI data sharing require their own clear choices; account creation alone is not consent to them.

P02 — Training profile. Store prioritized goals, training experience, equipment locations, available load ranges, preferred days, session duration, units, timezone, activity preferences, and relevant user-declared limitations. Optional measurements are time-stamped and source-labeled. Temporary readiness feedback is separate from permanent profile fields. Show users what the coach knows, permit correction/removal, and identify stale information before decisions rely on it.

P03 — Capture. Support a tested matrix of social URLs, web pages, pasted text, screenshots/photos, supported documents, and manual input. A durable import persists before expensive processing and survives leaving the app. Before third-party AI extraction, obtain the relevant disclosed consent for source/uploaded content; refusal permits manual/local-draft operation without AI transmission. Preserve captions, spoken instructions, relevant on-screen text, and source metadata where permitted and available. Source access, media rights, file limits, and unsupported cases are explicit. A failed source may be saved as a private bookmark/draft and completed manually.

P04 — Structured extraction. Classify exercise demonstration, accessory block/finisher, full session, or program. Extract source-supported exercise names/variations, required and optional equipment, sets, rounds, rep ranges, duration, distance, side/per-limb prescription, rest, tempo, effort/load instructions, warmup, cooldown, grouping and cues. Missing facts remain missing. Retain evidence and the original wording where useful; an inferred movement match is reviewable. Never copy a creator's load into a personal prescription without a distinct adaptation decision.

P05 — Library and exercise reference. Support private collections, search, filters by equipment/goal/type/duration, favorites, duplicates, manual corrections, and original-versus-adapted views. Exercise records include aliases, variations, instructions, reviewed demonstrations where rights permit, equipment and substitution relationships. “Related exercise” is not automatically an equivalent stimulus. Any public media displayed uses a permitted access method.

P06 — Personal adaptation. A workout can be kept as imported or adapted to equipment, experience, time, preferences, and limitations. Show the meaningful changes and reasons. Unknown critical details produce a question or explicit suggestion rather than fabricated extraction facts. Shorter sessions preserve purpose where possible. A user may reject a suggestion and manually edit. Adaptation produces a new version and does not rewrite the imported original or completed sessions.

P07 — Programs. Create multiweek general-fitness, strength/muscle, body-composition, running, and general athletic-conditioning programs. Use flexible goals and activities rather than separate sport products; running, workouts, and basketball are the first concrete use cases. Support app-created, user-authored, source-imported, and mixed programs. Capture primary/secondary goals, training availability, baseline, event dates where relevant, equipment and other activity. Use reviewed templates/rules with AI proposals constrained by validated structures. Surface material conflicts between goals rather than promising simultaneous maximal progress.

Running plans require baseline history or conservative user-provided starting information, preferred frequency, optional target event/distance, interval structures and recovery days. Session results can come from manual logging or permitted connected activity. Live GPS route recording and watch companion apps are separate product decisions, not assumed prerequisites for dedicated running programming.

Athletic goals such as basketball use reviewed general strength/conditioning work and account for practice/game days. A user may name another activity as context without that implying a validated sport-specific program. Avoid claims of personalized technical sport coaching, a supported catalog for every sport, or injury rehabilitation. D01 is resolved by Leon's preference for a general app; volleyball-specific programming is not a release requirement.

P08 — Calendar and adjustment. Present the active program, session purposes, upcoming week, and complete status. Support reschedule, swap, skip, pause, shorter alternatives, event-date changes, and return after interruptions. Changes affect future prescriptions through explicit versions; they do not rewrite history. Do not automatically stack missed sessions. Count other activities with honest coverage and deduplication. Rest is a normal program component.

P09 — Guided training. Provide exercise instructions, source access, planned targets, previous performance, actual results, timers and next-set controls. Support grouped exercises, bodyweight/load units, timed/distance work, warmups, partial completion, substitution, notes and perceived effort. Locally persist progress; interrupted connectivity does not erase a session. Notification permission is optional; in-app timers still work. The user can navigate to instruction/chat and return to the same set.

P10 — History and progress. Preserve actual sets/reps/load/time/distance, substitutions, partial sessions, notes and corrections. Show planned-versus-completed activity, strength/performance trends, running outcomes, goals, and optional measurement trends. Bodyweight and weighted variations are not automatically comparable; estimated best efforts and modeled recovery label methodology and limits. Calendar summaries respect timezone and avoid double-counting synced sessions. No implication that weight loss or uninterrupted daily exercise is the universal goal.

P11 — Actionable coach. Offer general coaching and contextual chat on a workout, session, exercise, goal or plan. Retrieve authorized current profile/plan/history instead of trusting a stale conversation summary. Treat imported content as untrusted data. Use source-linked explanations when supporting claims from an import. Proposed tools include create plan, adapt workout, schedule/move session, substitute movement, shorten session and update profile. Direct low-impact instructions may execute with an acknowledgment and undo; broad plan replacements show a proposed change before application. Ambiguous health/profile changes require clarification. No tool can exceed the user's ordinary authorization.

P12 — Health integration. Include optional Apple Health and Health Connect connections in the complete release. Useful initial types are completed exercise/activity summaries, available distance/duration, optional weight, and optional sleep/heart-rate summaries when justified. Final data types are minimized during native preflight. Distinguish permission to read on device, send to Håfa servers, use for AI coaching, and write actual completed Håfa workouts. Manual operation remains complete if access is unavailable or declined. Display last sync, coverage, provenance, errors and disconnection controls. Historical/background access depends on platform capability; do not promise continuous sync.

P13 — Intentional sharing. Share a selected workout or plan through an explicit preview and revocable link/in-app grant. Recipients receive a safe immutable/versioned copy or a bounded view; the UI explains which. Recipient adaptation does not change the sender's original. Personal measurements, restrictions, readiness, chat and training history are excluded unless separately authorized. No public Discover/feed is part of the confirmed release.

P14 — Håfa relationship. Shared branding/account language is visible on marketing, onboarding and Settings. “Håfa apps” offers stable destinations to the other app and a store fallback if absent. Each app works independently. Recipes connection grants specify direction, purpose and data categories. Proposed first connection: user-selected food preferences and selected recipe/meal-plan context for general meal support; neither permission is inferred from using one account. Workout health data is not automatically available in Recipes. Exact connected features must have acceptance before launch; no decorative toggle that claims an unused connection.

P15 — Free beta and future payment. All agreed product capabilities are free during beta, like Recipes. Reasonable operational limits may protect cost/availability; show them before a request and distinguish retryable failure from a consumed allowance. Record privacy-bounded per-product usage/cost and support configurable entitlements for future plans. Do not enable billing or choose a price without a separate product decision. Users retain access/export to their training records if commercial terms later change.

P16 — Support and account control. Provide help, issue reporting, profile correction, export, health/source disconnection, product-data controls and clearly scoped account deletion. Leon approved “Delete Håfa account” erasing both products and separate per-product data-removal controls that preserve the other product and login. Existing Recipes account deletion keeps its whole-account meaning; Workouts enrollment explains that this affects both products before creating a dataset. Operators receive bounded job/cost/failure diagnostics and audited recovery tools, without unrestricted private-content browsing. Deletion/connection revocation must cover stored context and derived AI memory. Technical legacy deletion compatibility is a release gate under D02.

## Canonical connected objects

| Object | Meaning | History rule |
| --- | --- | --- |
| Source/import | Material acquired and processing state | Evidence/access metadata is independent of workout readiness. |
| Exercise | Identified movement/variation | Reviewed catalog versions preserve historical meaning. |
| Workout version | An ordered prescription | Original and adapted versions are separate. |
| Program version | Goals, rules and planned progression | A change records effective future scope and reason. |
| Scheduled session | A date-specific prescription | Snapshot/version reference prevents silent template changes. |
| Training session | Actual execution | Corrections are traceable; planning never silently rewrites results. |
| Activity observation | External/manual recorded activity | Origin identifiers, deduplication and exclusions retained. |
| Profile/goal | Current declared training context | Changes/measurement dates distinguish current from historical context. |
| Connection/share grant | Specific authorized relationship | Revocation changes future access and derived context use. |

Every important record has a stable deep link and useful source/parent navigation. Returning restores the user's filters, calendar week, unsent draft or active session as applicable.

## Trust and release boundaries

The product supports adult general fitness. It does not diagnose illness, clear someone to exercise against restrictions, or promise treatment/rehabilitation. User-declared limitations are constraints with source/date/uncertainty, not clinician-verified diagnoses. Safety-sensitive requests may require a limited response and referral to appropriate professional guidance. Evidence and domain review precede numeric programming rules.

Apple requires explicit permission before sharing personal information with third-party AI; health information has additional protections. Use separate consents, minimum necessary context, redacted logs, private assets and meaningful erasure. [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/), [FTC health-app guidance](https://www.ftc.gov/business-guidance/privacy-security/health-privacy), [FDA general-wellness guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices).

Platform marketing claims do not authorize acquisition. Preserve attribution and verify permitted source access before advertising support; do not rehost creator videos by default. [YouTube policies](https://developers.google.com/youtube/terms/developer-policies). Strava API data cannot be assumed eligible for AI context; preserve data provenance across indirect integrations and review restrictions before ingestion. [Strava policy](https://www.strava.com/legal/api_policy).

## Completion and measurement

The complete release requires P01–P16 and all required [QA scenarios](QA_PLAN.md), including physical-device health integrations and old/new Recipes compatibility. Pre-release acceptance must pass before submission/release; R05's actual public availability is verified after release and remains pending until then. Necessary provider/store approval remains a gate; a mocked integration is not a delivered integration.

Measure source-specific usable import/correction rates, time to first performed session, planned-versus-completed sessions, continuation, rescheduling success, and cost per active user. Avoid content, health values and full source URLs in general analytics. Import volume and chat messages alone do not prove useful training.

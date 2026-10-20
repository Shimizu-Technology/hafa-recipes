# Håfa Baby

Owner: Leon. Primary user: Kami. Implementation authorized October 20, 2026.
Baseline: `cabe9fe` on shared API main; Recipes and Workouts remain compatible.

## Complete first release

A private personal pregnancy/baby companion: capture and retrieve saved advice;
write a journal with photos/documents; log feeding, sleep and diapers; manage
checklists, chosen routines and reminders; ask grounded general/focused questions.
The stages are construction order, not permission to omit agreed features.

One stable application user owns their data. A child is a profile, not a login.
No household setup is required. No cross-product private context is implicit.
Optional caregiver collaboration, public feeds, billing and wearables are outside
this release. Support multiple child profiles without making setup complicated.

## Experience brief

Calm, warm and contemporary. Legible typography, restrained sage/cream accents,
clear contrast, comfortable one-handed targets, useful empty states, and plain
language. Today gives fast logging; Library holds sources; Journal holds writing,
questions and care history; Routines holds checklists/schedules; Ask uses selected
context. Global Add is reachable without hunting. Preserve drafts, return paths
and search context. Editing with the keyboard open must remain comfortable.
Light/dark, large text, VoiceOver and reduced motion are acceptance dimensions.
Use native date controls and nonblocking confirmations. Motion cannot delay entry.

## Information boundaries

Keep imported source claims, caregiver observations and clinician-entered
instructions distinct. Importing never activates a medical schedule. Retain
original sources and evidence; missing details stay missing. AI proposes editable
changes, cites actual authorized records, and never treats source text as system
instructions. Provider processing requires explicit revocable consent. Existing
Recipes/Workouts data are not sent to Baby AI.

## API contract

Prefix `/api/v1/baby`; existing Clerk bearer auth resolves stable AppUser ID.
All data queries and attachments enforce owner plus active product generation.
Responses are JSON. Errors use HTTP status plus safe `detail` text. No private
content in telemetry. UUID IDs, ISO timestamps with offsets, bounded payloads.

- `GET /bootstrap`: read-only `{profile, children, generation, ai_available}`.
  Profile: `{display_name, timezone, ai_consent}`. `POST /bootstrap` initializes
  first use idempotently. A deleted space remains inactive until explicit
  `POST /enroll` with its current generation; reading never reactivates it.
- `PATCH /profile`: same profile fields; explicit AI consent.
- `GET /children`: `{items}`; `POST /children`; `PATCH /children/{id}`;
  `DELETE /children/{id}`. Child fields: `id,name,birth_date?,due_date?,revision`.
  Updates and deletion require the current revision; stale requests return 409.
  Deletion removes the profile and detaches its records, queued imports and
  conversations, preserving their content and attachment links with `child_id: null`.
  These records remain visible without a child filter and are excluded when
  filtering for a specific child.
- `GET /records?kind=&child_id=&q=&limit=30&offset=0`: `{items,total,has_more}`.
  Optional repeated `kinds=journal&kinds=question` filters up to eight valid kinds
  before pagination; do not combine `kind` and `kinds`. Child filters are exact
  by default; `include_general=true` explicitly includes unassigned records too.
  Optional `collection_id=<UUID>` validates a live same-owner/generation collection
  and returns only its live source members. Kind defaults to `source` for this
  filter; explicit non-source kind/kinds are rejected. Optional `topic=<1..80 chars>`
  matches an exact source topic. Collection/topic/search/child filters compose in
  SQL before totals and pagination; no frontend cache or individual member reads
  are required. Missing, foreign, deleted or wrong-kind collection IDs return 404.
  These filters are also accepted by `/search`; omitted filters keep existing behavior.
  `GET /records/{id}`, `POST /records`, `PATCH /records/{id}`,
  `DELETE /records/{id}?revision=N`.
- Record shape: `{id,kind,title,body,child_id,occurred_at,data,revision,created_at,
  updated_at}`. Kinds: `source,journal,feeding,sleep,diaper,routine,question,collection`.
  Creation accepts caller-generated `id` for durable retry; conflicting replay
  must not overwrite. PATCH requires `revision`; stale edits return 409.
- `data` is validated per kind: source `{url?,topics:[],source_text?,summary?,
  evidence:[],status?,attachment_ids?:[]}`. Source status is
  `saved|queued|processing|ready|incomplete|failed|cancelled` (or absent/null).
  `saved` means the original is stored without processing; `ready` means
  processing finished. Saving or editing a source never starts an import or AI
  call; explicit `POST /imports` is separate. Feeding
  `{method:breast|bottle|other,amount?,unit?:ml|oz,
  side?:left|right|both,duration_minutes?}`; sleep `{end_at?}`; diaper
  `{type:wet|dirty|both|dry}`; routine `{routine_type:checklist|schedule,
  items:[{id,label,done}],reminder_at?,timezone?,repeat?:none|daily|weekly,
  enabled?:boolean}`; journal/question `{attachment_ids?:[],
  provenance?:caregiver_observation|clinician_instruction}`; collection
  `{record_ids:[]}`. Plain body is always editable and never silently discarded.
- `GET /search?q=&kind=&child_id=&limit=30`: same record list envelope. Search
  covers source text, title, body, summaries and topics, not only recent records.
- `POST /imports`: `{id,url?,text?,attachment_ids?:[],child_id?,topics?:[]}`;
  returns `{id,status,record_id?,error?}`. `GET /imports/{id}`;
  `POST /imports/{id}/retry`, `POST /imports/{id}/cancel`. Persist before processing;
  retries/restarts cannot duplicate sources. Failed acquisitions preserve source.
- `POST /attachments` multipart `file`: private bounded upload, metadata
  `{id,name,mime_type,size}`; `GET /attachments/{id}` authorized bytes;
  `DELETE /attachments/{id}`. Files supported: images, PDF, allowed audio/video.
- `POST /chat`: `{conversation_id?,message,scope?:all|library|journal|care,
  record_id?,child_id?}` -> `{conversation_id,message,citations:[{id,title,excerpt}],
  proposal?:{kind,title,body,data}}`. Explicit consent; source-filtered retrieval;
  responses must admit missing evidence. `GET /conversations` and
  `GET /conversations/{id}` restore private history. A proposal is only applied
  through ordinary reviewed record creation, never a hidden AI write.
- `GET /export`: portable owner data including sources/journal/care/routines.
  `DELETE /data?generation=N`: product-only deletion; generation tombstone fences
  stale offline writes/imports. All writes send `X-Baby-Generation` after bootstrap.

Details may be tightened together, never changed independently in API/client.

## Construction and ownership

1. API core, models, additive migration, owner/revision/idempotency boundaries.
2. Capture/import processing, private attachments, evidence search and AI.
3. Independent `baby-mobile/` Expo app, complete native journeys and recovery.
4. Integrated native acceptance and full repository gate; independent review.
5. Small coherent PRs, merge readiness, restore point/migration, shared API deploy
   verification, independent bundle/project registration, signed TestFlight build.
6. Verify exact build source, Apple processing and internal tester availability.

## Required acceptance ledger

All initially `not_run`; agent executes on isolated fixtures. Physical-device-only
coverage remains explicit if unreachable. Record exact commit/build and evidence
in `.codex/qa/` during execution. No screenshots/test counts substitute for journeys.

- B01 Sign-in, onboarding and child creation/reopen; no household prerequisite.
- B02 Owner isolation, account change, revoked consent and deleted-product fencing.
- B03 Real link/text/image/PDF/video intake; processing, missing evidence and retry.
- B04 Cold/background recovery and repeated submissions produce one saved source.
- B05 Search an old source by words inside it; preserve library filters on return.
- B06 Journal with photo/document, edit/reopen and selected doctor-question summary.
- B07 Feeding/sleep/diaper quick logs, corrections, backdating and history.
- B08 Offline entry, restart, automatic sync, conflict recovery without silent loss.
- B09 Checklist and schedule import/review; no automatic reminder activation.
- B10 Notification permission, scheduling, edits, completion/cancel and timezone.
- B11 General/focused AI, history, correct citations, missing evidence and safe errors.
- B12 Review/apply an AI proposal; no record mutation before explicit acceptance.
- B13 Private attachment reads, export, Baby product-only deletion, and shared
  whole-account deletion. Product-only deletion removes Baby records, profiles,
  attachment metadata, imports and conversations, and queues private-media
  deletion. Verify the private files are removed after cleanup completes. It
  fences older generations while retaining the shared account and other products.
  Whole-account deletion removes Baby records, profiles, attachments, imports and
  conversations, queuing external identity/media cleanup; anonymous cost totals
  remain for the global spending window. Also verify that
  child deletion retains linked records/files and detaches imports/conversations.
- B14 Keyboard, small phone, large text, VoiceOver, dark/reduced-motion, long content.
- B15 Shared API/Recipes/Workouts regressions and operational restart/retry behavior.
- B16 Signed release build matches merged source; TestFlight processing and group.

## Release boundaries

The shared API domain and separate native app use the existing Recipes/Workouts
Clerk production instance. Baby has its own bundle, App Group and private data;
enrolling in Baby does not copy another product's private context.

Verify the complete engineering gate, final review, native acceptance, recovery
point, additive migration and intentional feature activation for each release.
Apple registration and signing profiles do not establish TestFlight delivery:
record the merged source, signed build, Apple processing and tester availability
separately. Keep platform limits and unrun device checks explicit. Credentials
stay in existing secure configuration. Re-check main before integration/release.


### Tab feedback validation

The native tab button uses immediate pressed opacity and a contrasting selected
icon pill; the web branch retains Expo Router's default link-aware button. This
small visual change uses actual native interaction checks rather than assertions
that repeat style constants or a new renderer harness. Validate all five routes,
exactly one selected accessibility state, press/release feedback, repeated taps,
detail/return context, light/dark appearance, compact screens and larger text.
Record the tested source, screenshots, outcomes and platform limits in the private
acceptance ledger. Type checking and the repository gate cover both platform
branches; a clean build alone does not establish native interaction acceptance.

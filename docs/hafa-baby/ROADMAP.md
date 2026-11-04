# Håfa Baby

Owner: Leon. Primary user: Kami. Implementation authorized October 20, 2026.
Baseline: `cabe9fe` on shared API main; Recipes and Workouts remain compatible.

## Complete first release

A private personal pregnancy/baby companion: capture and retrieve saved advice;
write a journal with photos/documents; log feeding, sleep and diapers; manage
checklists, chosen routines and reminders; ask grounded general/focused questions.
The stages are construction order, not permission to omit agreed features.

One stable application user owns their account. A child is a profile, not a login.
No household setup is required to start: each person has a private personal space,
and a family space appears only when someone invites another person. No
cross-product private context is implicit. Public feeds, billing and wearables are
outside this release. Support multiple child profiles without making setup
complicated. See "Family, tracker and calendar contracts" below.

## Experience brief

Calm, warm and contemporary. Legible typography, "Sand & Cocoa" warm neutrals
(sand and nude grounds, cocoa actions, a soft clay accent; chosen by Kami),
clear contrast, comfortable one-handed targets, useful empty states, and plain
language. Bottom bar: Today · Tracker · + · Saved · Ask, opening on Today. Today
answers "where are we right now" and holds one-tap logging. Tracker holds Day,
Calendar and Stats. Saved holds an uncategorized inbox, all posts and user-created
categories. Journal is a pushed screen for the person's own writing, private by
default. Ask knows what the person can see. Every log takes at most two taps from
opening, with no Save button and no trip back. Today links to pushed Lists &
routines with Back. The profile button opens settings and profiles. A focused Ask from an entry
stays in its stack with Back; notification links retain their owner/generation
checks and land on a routine or the pushed routines list. Global Add follows the current task. Bulk category selection preserves
membership on other devices and offers Undo. Source details lead with concise
attributed takeaways and explicit source-supported steps; original text, evidence
and processing details remain available on demand. Journal Save stays docked above
the keyboard; opening an empty editor does not leave an unfinished draft. Preserve drafts, return paths
and search context. Editing with the keyboard open must remain comfortable.
Light/dark, large text, VoiceOver and reduced motion are acceptance dimensions.
Use native date controls and nonblocking confirmations. Motion cannot delay entry.
Shared daily controls scale to 0.97 with a slight fade (120ms in / 160ms out,
strong ease-out, native driver); Reduce Motion uses opacity only. Primary text
scales without a cap, drops fixed line heights above 1.3×, and remeasures when
Dynamic Type changes while open. Rows/chips wrap. Routine sync occupies one
quiet line; failures expand into review actions. The floating Add has reserved
space above the tab bar so it cannot cover content.

## Information boundaries

Keep imported source claims, caregiver observations and clinician-entered
instructions distinct. Importing never activates a medical schedule. Retain
original sources and evidence; missing details stay missing. AI proposes editable
changes, cites actual authorized records, and never treats source text as system
instructions. Provider processing requires explicit revocable consent. Automatic processing of
new shares is a separate opt-in, off by default and gated by both permissions.
Sharing saves every original before import admission; existing import and spending
limits can defer processing without refusing the original. Revocation retires
queued and deferred automatic work, even if permission is later re-enabled.
Native sharing uses a Baby-only expiring capability bound to the stable owner,
installation and generation. Sign-out and erasure clear native authority and
captures before cleanup. Captures made before an owner is established are kept
unassigned rather than attached to a later account. Existing
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
  Optional `occurred_from` and `occurred_to` (with `/search` too) filter `occurred_at`:
  offset-required timestamps, from inclusive and to exclusive. Encode `+` in a query.
  Optional repeated `kinds=journal&kinds=question` filters up to every valid kind
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
  updated_at}`. Kinds: `source,journal,feeding,sleep,diaper,routine,question,collection`,
  plus `event,contraction,kick_session,pumping,medicine,temperature,growth,milestone,custom`.
  Only requests with `X-Baby-Client: 2` see or write those nine: any other request gets the
  first eight on list, search, record and export, 404 for a newer record, and 422 on create.
  Creating one also needs `BABY_NEW_KINDS_ENABLED`, set after migration 055; until then
  the create returns a retryable 503.
  Creation accepts caller-generated `id` for durable retry; conflicting replay
  must not overwrite. PATCH requires `revision`; stale edits return 409.
- `data` is validated per kind: source `{url?,topics:[],source_text?,summary?,
  evidence:[],status?,attachment_ids?:[]}`. Source status is
  `saved|queued|processing|ready|incomplete|failed|cancelled` (or absent/null).
  `saved` means the original is stored without processing; `ready` means
  processing finished. Saving or editing a source never starts an import or AI
  call; explicit `POST /imports` is separate. Feeding
  `{method:breast|bottle|other,amount?,unit?:ml|oz,
  side?:left|right|both,duration_minutes?,state?:running|finished|unknown_end,
  actions?:[{id,action:start|switch|finish,at,side?:left|right}],end_at?,
  contents?:breast_milk|formula}`; sleep `{end_at?}`; diaper
  `{type:wet|dirty|both|dry,color?:black|green|yellow|brown|red|white}`; event
  `{timezone,end?,all_day?,category?,location?,attendees?:[],
  recurrence?:{frequency:daily|weekly|monthly|yearly,interval?,until?:date},
  exceptions?:[{original_start,cancelled|overrides}],attachment_ids?:[]}`; contraction
  `{end_at?}`; kick_session `{end_at?,count?}`; pumping `{end_at?,side?,amount?,unit?,
  duration_minutes?}`; medicine `{name,dose?}`; temperature `{value,unit:c|f,
  method?:armpit|rectal|oral|ear|forehead|other}`; growth `{weight?,weight_unit?:kg|lb,
  length?,length_unit?:cm|in,head?,head_unit?:cm|in}` with at least one measurement;
  milestone `{milestone_id?,attachment_ids?:[]}`; custom `{label?,value?,unit?}`.
  PATCH keeps the feeding and diaper additions when a client omits them; only an explicit
  null clears one, and `actions` only change through `feed-action`, `session_actions` only
  through `session-action`. Changing `side` or
  `duration_minutes` by hand on a feed with actions makes it a plain finished entry, and
  changing `occurred_at` moves its start action. `contents` applies to bottles, `color` to poo, and `state`, `actions`
  and `end_at` to breastfeeds; a change of method or type drops what no longer applies;
  routine `{routine_type:checklist|schedule,
  items:[{id,label,done}],reminder_at?,timezone?,repeat?:none|daily|weekly,
  enabled?:boolean}`; journal/question `{attachment_ids?:[],
  provenance?:caregiver_observation|clinician_instruction}`; collection
  `{record_ids:[]}`. Plain body is always editable and never silently discarded.
- Sources may carry `relevance` `{stage?:pregnancy|postpartum|baby,
  pregnancy_week_min?,pregnancy_week_max?,baby_age_min_weeks?,
  baby_age_max_weeks?,baby_age_unit?,quote?,origin:source|user}`, set only when
  the source states timing (its quote must appear as whole words in what was
  read and state every bound) and editable by the user, and `suggested_category`
  `{name,collection_id?,confidence,status:pending|accepted|dismissed}`. Only
  extraction writes `origin:source`; app-set timing is `origin:user` without a
  quote, and clearing stored timing keeps an empty `{origin:user}` marker so
  reprocessing cannot restore it. A suggestion never files a source; the user
  accepts or dismisses it with `POST /records/{id}/suggested-category` or
  `POST /suggested-categories` (bulk). PATCH keeps either field when a client
  omits it.
- `GET /records?timing=now|upcoming` filters sources by the current pregnancy
  week (completed weeks from a child's due date; the ongoing pregnancy wins over
  born siblings, and a due date past 44w6d without a birth date asks for one) or
  baby age (from birth date), or by an explicit `pregnancy_week`/`baby_age_weeks`;
  `within_weeks` is for `upcoming` only; `stage=` filters by stated stage.
- `GET /care/summary?from=&to=&child_id=`: inclusive dates in the profile time zone, up to
  92 days. Without `child_id`, the logs that have no child. Returns the stats service's totals
  and `days:[{date,partial,feeding,diapers,sleep,dots:[feeding|diaper|sleep]}]`. Days
  after today are left out, and a wholly future range has no days.
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

## Family, tracker and calendar contracts

Decided November 4, 2026 with Leon and Kami. These extend the API contract above
and win where the two differ. Details may be tightened together, never changed
independently in API and client.

### 1 The core rule: two kinds of space

Everyone has one **personal space**. A **family space** is separate and is created the first time someone invites another person. **Private means "stored in your personal space."** There's no visibility flag to filter on.

- Access has one rule: you can read a row if its `space_id` is a space you're an active member of (caregivers also get a kind filter).
- **Shared by default, stored in the family space when one exists:** baby profiles, care logs, contractions, kicks, events, milestones, doctor questions, lists, saved posts and categories.
- **Personal by default:** journal entries. **Always personal:** Ask chats.
- The per-item toggle "Shared with family / Just me" (saved posts, categories, and one journal entry at a time) **moves the row** with one function, `move_record()`. A journal entry its writer shares is a family row like any other: every parent can read it, and each parent's Ask can use it. Un-sharing moves it back. Only the writer can share or un-share a journal entry.
- Choosing "Just me" also sets `data.just_me: true`. This is not an access rule, which stays the space. It only tells Create family to leave that row in the personal space.
- **Same-space references only.** A collection, its members, a suggested category, and a record's attachments must all be in the record's space, enforced in `validate_relations`. Care records live in their child's space. The one exception: a personal journal entry may point to a family child. If that child can't be read any more (the person left, or the child was deleted), the link is ignored on read and cleared on the next edit. Nothing ever writes into another person's personal space.
- This removes hidden references: a family row can't point at a private row, so search over stored JSON and raw responses can't reveal one.

### 2 Tables

| Table | `space_id` | `app_user_id` | On account deletion |
|---|---|---|---|
| `baby_memberships` (person's Baby account) | none; adds `personal_space_id` | PK, stays CASCADE | Removed |
| `baby_spaces` (new): `kind` personal or family, `generation`, `change_seq`, `timezone`, `status` | is the id | `created_by`, SET NULL | Personal erased. Family erased if no parent remains |
| `baby_space_members` (new): role, status, `access_version` | yes | CASCADE, handled first by app | Removed |
| `baby_space_invites` (new): hash, role, expiry, used, revoked | yes | `created_by`, SET NULL | Revoked by app |
| `baby_children`, `baby_records`, `baby_attachments` | NOT NULL after 058 | creator, nullable, SET NULL | Personal rows go with the personal space. Family rows stay as "former member" |
| `baby_moved_out` (new): tombstones `(space_id, seq, record_id)` | yes | none | With its space |
| `baby_imports` | NOT NULL after 058 | actor, CASCADE | Cancelled and removed |
| `baby_conversations`, `baby_messages` | personal space; add `context_space_ids` | owner, CASCADE | Removed |
| `baby_share_credentials`, `baby_share_captures` | NOT NULL after 058 | actor, CASCADE | Removed |
| `baby_ai_admissions` | none | unchanged, SET NULL | Kept anonymous |

`app_user_id` is never rewritten. On children, records and attachments it comes to mean "created by." A code comment and the roadmap say so.

### 3 Resolving the space on each request

In this order:

1. **Share credentials and background jobs** use their stored `space_id`. A conflicting header fails.
2. **Requests with `X-Baby-Client: 2`:**
   - Reads return everything across the caller's spaces.
   - Writes must send `X-Baby-Space`, or they fail with 422. It must be a space the caller is an active member of, or 403.
   - Bootstrap never needs a space. It returns `spaces: [{id, kind, role, generation, access_version}]`, plus `personal_space_id`.
3. **Requests with no client header (build 32):** served from the personal space only, with v1 kinds, and with new data fields kept when omitted (the `SOURCE_ADDITIONS` pattern). Bootstrap's `generation` is the personal space's, so it never decreases (`api.ts:159`). Build 32 can't see or write family data at all.

`X-Baby-Generation` is compared to the resolved space's generation, never `baby_memberships.generation`.

**Because old builds only see the personal space,** Kami must update before creating a family, or her baby profile would disappear from her old build. Only `X-Baby-Client: 3` can create a family or accept an invite.

### 4 Device storage

No partition switching. One actor vault, as today.

- Records, children and outbox items carry `space_id`. Outbox items carry that space's generation too. Generation fencing and the API's `knownGeneration` become a map by space.
- Joining adds a space and removes nothing. Local drafts and unsynced work are untouched, so the preflight isn't needed.
- Each write targets its record's space. New items: care follows the child; other shared kinds go to the family if one exists; journal goes to personal.
- **Leaving or removal:** rows for that space are purged locally. Outbox items for it stop retrying and show as "Not sent: you're no longer in this family," with **Keep in my personal space** (copies under a new ID). A removed phone can't be purged while offline, and the removal screen says so.
- Mounted screens: role or space-list changes remount through `<SpaceBoundary key={accessKey}>`, so open editors, history pagers and Ask memory reset.
- Build 32's cached account storage migrates once, with `space_id` set to personal, keeping pending work.
- **Native captures** are tagged with their destination, generation and identity. The native store gets a one-time migration and a **non-destructive rebind** operation. Today, binding a new scope calls `clearLocked()` and deletes pending captures (`BabyShareStore.swift:96`), so that clear stays reserved for sign-out and erasure. The credential rotates when a family is created or left.
- Sign-out clears the whole actor vault and files, as today.

### 5 Attachments

- An attachment belongs to one space, the same as its record. Reads are allowed to members of that space. Unattached uploads are visible to the uploader only.
- Delete: uploader, or a parent for family files. Retention checks all live references in the space.
- `move_record()` moves a file with its record when nothing else uses it. If another record in the old space still references it, the file is **copied** to a new attachment with its own object, so neither space ever reads across. Production has no attachments today, so this is a tested rule rather than a data migration.
- All cleanup and quota checks use the stored `object_key`, and keep the cleanup worker's validated prefix format and asset lock. Fix `attachments.py:180`, which rebuilds it from generation.

### 6 Fetching changes

- Every write locks its space row (`access_for`) and stamps the row with `change_seq` from `UPDATE baby_spaces SET change_seq = change_seq + 1`. The row lock makes the sequence commit-ordered per space, so a cursor can't skip a late commit.
- One helper, `touch(row, space)`, does this for routes **and workers**, and also fixes the worker branch that changes data without advancing it (`runtime.py:331`). A test asserts every mutation path goes through it.
- `GET /changes?cursor={space: seq}` returns rows above the cursor, soft deletes as `{id, removed: true}`, moves via `baby_moved_out`, and each space's `access_version`. Paged by seq, with `has_more`. Starting from 0 is the first snapshot.
- If `access_version` changed, the client resets from a fresh snapshot.
- **Baseline:** F3's rerun gives every existing row a positive `change_seq`, so a snapshot from 0 includes them. R1 ships only after every writer in F4 uses `touch()`.
- Called every 15 seconds in the foreground, on open, on reconnect and on silent push.

### 7 Feeds

A running feed stores its actions, and everything else is derived by one pure reducer on the server, mirrored in the app.

- `data.actions: [{id, action: start|switch|finish, at, side?}]`. Order: `(at, id)`.
- **Tap Left or Right:** create the record with a `start` action. **Tap Both:** create a finished record with `side: both`, no duration.
- `POST /records/{id}/feed-action {action_id, action, at, side?}`: idempotent by `action_id`, with a payload check, no revision needed. It still increments `revision` and `change_seq`, so ordinary editors and `/changes` stay correct.
- **Reducer:** the earliest `finish` is terminal. A `switch` before it applies even if it arrives later. Later actions are kept but have no effect. Duration comes from the segments, only when finished.
- **Per child:** the newest `start` is the running feed, whatever order they arrive in, with ties broken by record id. Older running feeds become `unknown_end`: no end time, no duration, left out of minutes in Stats, which says so. A running feed older than 60 minutes shows as not running.
- **Client:** a new durable `feed_action` outbox type, ordered behind its record's create via `mutationRecordId`.
- **Proof for waiting edits:** each stored action carries the `revision` it produced, set by the API, so a phone replaying a lost response moves a waiting edit only past its own write.
- **Sessions:** `POST /records/{id}/session-action {action_id, action: tap|undo|finish, at, target?}` is the same idea for `kick_session` (tap, take back, finish) and `contraction` (stop). `data.session_actions` holds them, bounded at 1000 and 20; `count` and `end_at` are derived. Two phones never conflict, and overlapping sessions all stay finishable.
- **Tests:** permutations of finish and switch races, timestamp ties, reversed starts, concurrent ordinary edits.
- `side` is `both` once more than one side was used. A finished feed with no actions (a Both tap, or any older feed) also counts as the newest feed for its child, and refuses actions with 409. A bottle does not close a running feed. Undoing the newest feed restores the one before it. A finish after a feed became `unknown_end` still finishes it.
- Old device timers finish the old way, then are gone. Next side: opposite of the side the last feed started on (P3).

### 8 Leaving, deleting, un-sharing

| Action | Effect |
|---|---|
| Create family (first invite) | One transaction: family space created; shared kinds and their children move from personal with `move_record()`; journals, and any row with `data.just_me`, stay. Before a first family exists the toggle isn't shown, so all saved posts and categories move unless the person unticks them on the Invite screen, which sets `data.just_me`. Credential rotates |
| Leave, or removed by a parent | Membership ends. Personal space untouched. Shared records stay, shown as logged by them. Their chats with that family in `context_space_ids` are deleted. The last parent can't leave; they choose Delete family, with export offered |
| Delete account from any Håfa app | Personal space and chats erased. Family rows stay as "former member," via SET NULL. Last parent: family erased. Only files actually deleted are queued for cleanup |
| Baby `DELETE /data` | Erases the caller's personal space and chats. For family data: leave, or Delete family if last parent |
| Delete a child (parent) | Detaches across the family space, for all members. Journal links in personal spaces are handled by the read rule in 4.1 |
| Share to "Just me" | `move_record()`, removed from family categories, tombstone written. The confirm dialog says: "Answers Ask already gave in other chats may still mention this." Citations to it stop opening right away |

**Writes caught mid-move.** A second phone, or a queued offline write, can still hold the old space.

- **Create replays** look up the row by its original ID, check the caller can read its current space, and return the current row with its space. Generation is only compared for brand-new creates. This applies equally to children, imports and captures.
- **Edits and deletes** to a moved row get `409 {code: "moved", space_id, generation, revision, record}`. The client updates the queued item's space and generation and retries; a real edit conflict falls into the existing review flow.
- **New care for a moved child:** the same response, and the client retargets it to the child's space automatically.
- **Other queued personal items stay personal.** Pending private content is never published automatically.
- Moves increment `revision` and `change_seq`. Personal generation doesn't change, so `fencedState` doesn't wipe pending work.
- The Invite screen lists what becomes shared before Create family runs. That disclosure is the only automatic publish.

**Imports caught mid-move.** `move_record()` clears the job's lease and requeues it with the new space and generation, keeping the original and the actor's consent. The worker's gates and completion verify stored space, generation, lease and authorization, discard stale results and validate generated relations. Requeued work reloads the destination's categories, so private category names can't reach a family source.

**Lock order, everywhere:** discover what's affected; lock `app_users` rows in ascending order; lock `baby_spaces` in ascending order; lock records and assets; re-check what was discovered, and retry if it changed. No space lock is held during media processing or AI calls: the worker keeps short claim and completion transactions.

**There's no retroactive rewriting of chat text.** A person can't unsee something, and tracking that lineage across chat turns isn't worth its risk. The dialog says so. On removal, chats tied to the family are deleted.

**All of this ships and passes before anyone real joins.**

### 9 Calendar events

- `event` record: `start` (`occurred_at`), `end`, `all_day`, `timezone`, `category`, `location`, `child_id` or whole family, `attendees`, and `recurrence` (`daily|weekly|monthly|yearly`, interval, `until`).
- `GET /events?from&to`: range up to 400 days, up to 500 occurrences, returned as `{event_id, occurrence_start, ...}`.
- Expansion starts from all recurring events in the space, not only those dated in range, so older repeats aren't lost.
- Occurrence identity is `event_id + original start`. Exceptions are stored in `data.exceptions` as `{original_start, cancelled | overrides}`.
- Month-end repeats clamp to the last day. Computed in the event's time zone.

### 10 Push delivery

- Worker: in-process task started and stopped in `main.py` lifespan, like the import worker, with its own advisory lock and short claim transactions. Rechecks membership and prefs right before sending.
- Delivery is **at-least-once.** A send whose outcome is unknown is retried once with the same `collapseId`, which on iOS replaces a shown duplicate. Duplicates remain possible and are acceptable; lost reminders aren't. Receipts checked at about 15 minutes.
- A reminder ends in one of `accepted`, `failed` or `unknown`. `accepted` only means the provider took it, not that a phone showed it. After the one retry an unknown send stays `unknown`: it isn't sent again, so a parent isn't alarmed repeatedly at night, and it's counted in operational logs.
- **Push is never the only record of a reminder.** Any due reminder also appears on Today until it's dismissed or its condition clears (for example, a feed gets logged), whatever its delivery state.
- The offline local copy uses the same identity, and is cancelled on sync.

### 11 AI admission

`budget.py` currently reserves a Chat Completions envelope under a Workouts capability, and `workouts/budget.py` only prices the two `gpt-5.6` models, so **changing `BABY_AI_MODEL` today fails closed**. Q0 adds a Baby provider and admission path: priced model list, Responses endpoint, $10-per-1,000-search charge, per-call reservations, up to 5 tool rounds per question, cancellation gates. Per-person limits stay per actor; global anonymous spend stays global.

**Consent versioning:** `ai_consent: true` alone doesn't authorize a new provider or web search. Add `ai_consent_version` to the profile. `BABY_ASK_V2` runs only for people who acknowledged the current version, and everyone else stays on the existing path. Changing provider (for example, if Haiku wins) bumps the version.

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

Google uses one continuation from either account screen: existing accounts sign
in; a verified new Google email proceeds to explicit account creation and adult
confirmation without repeating OAuth. A new shared owner is provisioned before
private Baby queries begin. Session hydration and bounded transient startup
retries stay in the loading state; authentication/conflict failures remain closed
with deliberate recovery. A completed provider callback alone never authorizes
silently creating an owner or merging another account's library.

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


### R1 enablement and baseline runbook

Keep `BABY_FAMILY_ENABLED=false` in production while deploying this stack. The lead enables it only after the F4 fixes and F9c are deployed and verified, migration 058 is applied, and every instance/worker from before F2 is gone. Keep `BABY_INVITES_ENABLED=false` and do not create any family yet.

1. Establish the restore point and confirm no family spaces exist.
2. Enable `BABY_FAMILY_ENABLED` on **every** API instance and worker; verify the running release. `touch()` supplied no destination while the flag was off, so an earlier F3 run does not establish the sync baseline.
3. Rerun F3 dry-run, then apply with its append-only audit. Verify `null_space_ids=0` and `rows_assigned=0`, then independently require **zero NULL `change_seq`** across children, records, attachments, imports, conversations, messages, share credentials and share captures. Repeat the verification after a final dry-run. Stop on conflicts or missing rows.
4. Exercise a synthetic client-3 snapshot from cursor 0 and a worker update. Only after the baseline and privacy matrix pass may the lead enable invites and begin the synthetic rehearsal.

`GET /changes` is client-3-only and returns 404 with the family gate off. `cursor` and optional `access_version` are JSON maps of space UUIDs to integers (at most eight spaces); `limit` is 1–100 per space. The response has `spaces`, the next `cursor` map, `has_more`, and `removed_space_ids`. Each space page includes `id`, `generation`, `access_version`, `cursor`, `has_more`, `reset`, and `items`. Items carry `seq` and `entity`; removals carry `id`, `removed: true`, and `seq`. No raw import requests, capability hashes or tokens are returned. Pass the last access versions on subsequent pages: `reset: true` requires a fresh snapshot from zero. A missing former space must be purged locally. Pages lock access until their database transaction closes and never hold locks during external processing.

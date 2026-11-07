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
  `DELETE /children/{id}`. Child fields: `id,name,birth_date?,due_date?,details,revision`.
  `details` holds optional setup answers (`sex,weight_at_birth_g,length_at_birth_cm,weeks_at_birth,feeding,tracking`). A PATCH changes only the keys it sends; null clears one, and leaving `details` out keeps them all. Needs migration 059.
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

**Care contacts.** `PATCH /profile/contacts` keeps her doctor and where she plans to deliver in `baby_memberships.profile`; `details.doctor` on a child keeps the baby's doctor, so it goes with the baby and everyone in the family reads it. Each is a name and a phone number, with what a copied number brings along cleaned up the same way by the app and the API. Bootstrap always carries `contacts`, which is how a phone knows the API keeps them, and the fields stay hidden until then. Her own are stored in `baby_memberships.profile` under `contacts`, and they're in `SERVER_PROFILE_FIELDS`, so they're never in the `profile` a phone reads and echoes back, and nobody else reads them. They're in her export and removed with her data. No request to a model carries any of them: the Ask context and tools name the child fields they send, and `test_baby_contacts.py` checks that at the HTTP layer.

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
2. **Requests with `X-Baby-Client: 3`, with the family flag on:**
   - Reads return everything across the caller's spaces.
   - Writes must send `X-Baby-Space`, or they fail with 422. It must be a space the caller is an active member of, or 403.
   - Bootstrap never needs a space. It returns `spaces: [{id, kind, role, generation, access_version}]`, plus `personal_space_id`.
   - Below client 3, reads and writes stay in the caller's personal space, and any other `X-Baby-Space` gets 403.
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
- If `access_version` changed, the client resets from a fresh snapshot. Removing an attachment reference also advances access versions: discard the old snapshot so formerly readable upload metadata is evicted without disclosing never-readable upload IDs.
- **Baseline:** F3's rerun gives every existing row a positive `change_seq`, so a snapshot from 0 includes them. R1 ships only after every writer in F4 uses `touch()`.
- Called every 15 seconds in the foreground, on open and on reconnect.

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
- **Other queued personal items stay personal.** Pending private content is never published automatically. A question or import with a personal upload stays personal and clears a child link that moved to the family.
- Moves increment `revision` and `change_seq`. Personal generation doesn't change, so `fencedState` doesn't wipe pending work.
- The Invite screen lists what becomes shared before Create family runs. That disclosure is the only automatic publish.

**Imports caught mid-move.** Before a post moves into personal space, another actor's jobs are cancelled in their original space; they never enter the creator's personal space. `move_record()` clears the moving actor's job lease and requeues it with the new space and generation, keeping the original and the actor's consent. The worker's gates and completion verify stored space, generation, lease and authorization, discard stale results and validate generated relations. Requeued work reloads the destination's categories, so private category names can't reach a family source.

**Lock order, everywhere:** discover what's affected; lock `app_users` rows in ascending order; lock `baby_spaces` in ascending order; lock records and assets; re-check what was discovered, and retry if it changed. No space lock is held during media processing or AI calls: the worker keeps short claim and completion transactions.

**There's no retroactive rewriting of chat text.** A person can't unsee something, and tracking that lineage across chat turns isn't worth its risk. The dialog says so. On removal, chats tied to the family are deleted.

**All of this ships and passes before anyone real joins.**

### 9 Calendar events

- `event` record: `start` (`occurred_at`), `end`, `all_day`, `timezone`, `category`, `location`, `child_id` or whole family, `attendees`, and `recurrence` (`daily|weekly|monthly|yearly`, interval, `until`).
- `GET /events?from&to`: range up to 400 days, up to 500 occurrences, returned as `{event_id, occurrence_start, ...}`.
- Expansion starts from all recurring events in the space, not only those dated in range, so older repeats aren't lost.
- Occurrence identity is `event_id + original start`. Exceptions are stored in `data.exceptions` as `{original_start, cancelled | overrides}`.
- Month-end repeats clamp to the last day. Computed in the event's time zone.
- `reminder_minutes` (up to 5, up to 4 weeks) sets when reminders go: minutes before the start, or before 9 AM on an all-day event's first day. Omitted when empty.
- `POST /events/{id}/split` changes a repeat from one date on: it ends the series and creates its replacement in one transaction, under a client-chosen ID, so a retry gets the same answer. `recurrence.anchor` keeps the date the count started on, so a Jan 31 series split at Feb 28 still gives Mar 31.
- A question or note can only link to its own child's event or a whole-family one; general ones fit any. Giving an event to another child lets go of the links that no longer fit. `GET /records?event_id=` reads one event's records.

### 10 Push delivery

- Worker: in-process task started and stopped in `main.py` lifespan, like the import worker, with its own advisory lock and short claim transactions. Rechecks membership and prefs right before sending.
- Delivery is **at-least-once.** A send whose outcome is unknown is retried once with the same `collapseId`, which on iOS replaces a shown duplicate. Duplicates remain possible and are acceptable; lost reminders aren't. Receipts checked at about 15 minutes.
- A reminder ends in one of `accepted`, `failed` or `unknown`. `accepted` only means the provider took it, not that a phone showed it. After the one retry an unknown send stays `unknown`: it isn't sent again, so a parent isn't alarmed repeatedly at night, and it's counted in operational logs.
- **Push is never the only record of a reminder.** Any due reminder also appears on Today until it's dismissed or its condition clears (for example, a feed gets logged), whatever its delivery state.
- The offline local copy uses the same identity, and is cancelled on sync. `GET /reminders/upcoming` lists what a phone can hold: identity, the time it would go (after quiet hours) and lock-screen words only. There's no silent push: nothing wakes or launches the app, so a phone catches up when she opens it.
- **Phones and settings** (behind `BABY_PUSH_ENABLED`, client 2 or newer): `PUT` and `DELETE /push/devices/{installation_id}`, `GET` and `PATCH /push/prefs`.  Bootstrap carries `reminders: {push: true}` only while the flag is on, so a phone with it off makes none of these calls and asks for no permission. A person's settings are stored with their personal space and apply to every space they belong to, so Create family moves nothing. Every reminder type is off until a person turns it on, and the feed reminder has no default interval. Quiet hours belong to the person and are compared as instants, so a deferral is always in the future across a clock change. There's no setting for lock-screen detail: lock-screen text stays generic. `PUT` returns a `registration`, and `DELETE` must send it back, so a sign-out that arrives after a newer sign-in leaves that sign-in in place. Sign-out and erasure remove the token; a phone belongs to whoever signed in last. Registering is limited to 30 times in 10 minutes per person; sign-out never is. All generation headers on these routes are the personal space's. Push tables are in erasure discovery, and `/data` and account deletion clear them in every space.
- **Worker** (`push_worker.py`, needs `EXPO_ACCESS_TOKEN`; without one nothing is sent and Today still works): one row is one reminder for one person, sent to the phones they have at that moment. One claim is one request to Expo, at most 100 messages (overflow goes back to waiting without using an attempt), a person's phones together, with its own advisory lock held only while leasing, never during a send and never waiting on imports. One final check is the last thing before each request: for each reminder its role, settings, record, due time by today's settings and zone, and quiet hours; then the phones, the message cap on what is actually prepared, the membership and the lease, which is renewed. It takes at most 5 seconds, and what it hasn't reached waits, so a batch can't outlast its leases or disclose a previous account's anything. A change that lands after it races the request itself. A lease that runs out, a read timeout or a 5xx is an unknown outcome and spends the one retry. A connection that never opened, a 429 or a bad token is not, and backs off for about an hour and a half before `failed`. `MessageRateExceeded`, in a ticket or a receipt, retries only that phone; its tries are stored per phone in `provider_ticket`. Rows don't sync through `/changes`, so they never `touch()`. `GET /reminders/due` and `POST /reminders/{id}/dismiss` are Today's list. Leaving or being removed cancels what's pending for that space.
- **Triggers** (`triggers.py`): only the worker plans, from what is committed, so no log's transaction has a reminder write in it to fail. A commit that changes a record, child, import or membership wakes the worker through session listeners that exist only while it runs and can't fail a write; a 15-minute paged sweep catches anything missed, including everything a restart missed, and plans two days ahead for what no write announces. Each reason is rechecked when read. When a reason goes, a waiting reminder stops and a delivered one leaves Today but keeps its delivery state; if the reason returns (the newer feed is deleted), the plan brings it back without sending again. A person's dismissal is separate and nothing undoes it. Quiet-hours holds are recomputed on each plan, and a provider's backoff is left alone. A profile change wakes planning. Event reminders follow edits, exceptions and deletes. Visit prep goes at 6 PM the evening before. Import notices go only to the person who asked.
- **On the phone:** everything hangs off bootstrap's `reminders.push`, so with the flag off a phone makes no calls, asks for no permission and shows nothing. Permission is asked only when a person turns something on, after a sentence saying why. A phone registers whenever notifications are already allowed, and sends its `registration` back at sign-out. Settings save through the outbox like What shows. A tap looks up `notification_id`; gone, offline or lost access lands on Today with one plain sentence. Offline copies are held only while the phone knows it's offline, since online a copy could only sound twice or go stale after another phone's log. There's no silent refresh and no background mode, so nothing launches the app while the phone is locked: Clerk's own token cache deletes a credential on a read error, and ours keeps it regardless. Copies are scheduled while the app is open, and what's due shows when she opens it. Settings queued while the flag is off stay queued and go if it comes back. A sign-out's revocation counts only once the API confirms it; until then the phone stops taking pushes, across launches, and the revocation waits for the next chance.
- **Care reminders:** the feed reminder runs from the newest feed per child, N hours set per person with no default, off by default, one row for each parent who turned it on. A feed logged on any phone moves it for all of them on the worker's next pass, and the old one can't go out even before that, because the final check reads the newest feed and today's interval. A new setting or zone moves a due time at that same check. A running feed has none until it finishes. Timers left on remind after 1 hour (feed) or 4 hours (sleep) unless the person sets otherwise. A new pregnancy week goes at 9 AM on its first day in the person's zone. Milestone window and well visit are stubs until K4a and K4b land approved content; their settings exist and nothing is scheduled. A private item in a personal space can only ever reach that person, since each person is planned from what they can read.
- **Routines (N5):** a routine's own schedule on a phone keeps firing, with or without the API, so nothing has to be handed over and no reminder can be lost in a handover. Each phone reports what it holds with `PUT /push/devices/{installation_id}/routines`, replacing its last report. The API plans each person's routines from their first report, shows them on Today, and pushes one only to a phone that has reported and doesn't hold it at its current schedule, such as one that hasn't seen an edit yet. A phone that has never reported gets none, since it may still hold its old schedule. Needs migration 061, and until that's applied `reminders.routines` isn't in bootstrap and everything stays as it was.
- **Lock screen:** a provider gets only fixed text for each kind, plus `notification_id`, `space_id` and `identity`: no name, title, time, week or reminder type, for any item. A tap looks the reminder up by `notification_id` through `GET /reminders/{id}/tap`, with the same test as Today's list: a 404 means gone, not readable or not due. Today, on the person's own phone, is where details show. **Caregivers** hear only about events and running timers; everything else is for parents.

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

1. Establish the restore point and confirm no family spaces exist. Before applying 058, verify the running API release includes F9c (#516), including the Recipes account-deletion path; stop if it does not. Apply 058 only after its restore-point and F3 null-space checks pass.
2. Before this step, set `BABY_FAMILY_TEST_USERS` to the synthetic accounts' application user ids (see below). Enable `BABY_FAMILY_ENABLED` on the Render service, one key plus a deploy, so it reaches every API instance and worker; verify the running release. Keep the invite flag off at this step. The live service isn't on a Blueprint, so `render.yaml` only records what production runs, and changing it deploys nothing. Never use Render's bulk env update, which replaces every variable. `touch()` supplied no destination while the flag was off, so an earlier F3 run does not establish the sync baseline.
3. Rerun F3 dry-run, then apply with its append-only audit. Verify `null_space_ids=0` and `rows_assigned=0`, then independently require **zero NULL `change_seq`** across children, records, attachments, imports, conversations, messages, share credentials and share captures. Repeat the verification after a final dry-run. Stop on conflicts or missing rows.
4. Exercise a synthetic client-3 snapshot from cursor 0 and a worker update. Only after the baseline and privacy matrix pass may the lead enable `BABY_INVITES_ENABLED` the same way, verify it on every instance, and begin the 48-hour synthetic rehearsal. Invite creation, preview and acceptance require this flag on; use synthetic accounts only. No real accounts join until the rehearsal passes and every signed-in phone is updated. If rehearsal fails, disable invites on the service and stop the rollout. Once a family exists, `BABY_FAMILY_ENABLED` stays on: turning it off splits the parents' records, so invites off is the only rollback.

`GET /changes` is client-3-only and returns 404 with the family gate off. `cursor` and optional `access_version` are JSON maps of space UUIDs to integers (at most eight spaces); `limit` is 1–100 per space. The response has `spaces`, the next `cursor` map, `has_more`, and `removed_space_ids`. Each space page includes `id`, `generation`, `access_version`, `cursor`, `has_more`, `reset`, and `items`. Items carry `seq` and `entity`; removals carry `id`, `removed: true`, and `seq`. No raw import requests, capability hashes or tokens are returned. Pass the last access versions on subsequent pages: `reset: true` requires a fresh snapshot from zero. A missing former space must be purged locally. Pages release their access locks before returning the response and never hold locks during external processing.

### Rollback floor: `category_label`

Once any event has a `category_label`, the API rolls forward only. A release from before it refuses the field: labelled events drop off the calendar, and edits to them are refused, until it's rolled forward again. The rows stay stored. Before any event has one, rolling back is safe.

### Rollback floor: care contacts

Her doctor and delivery place are stored in `baby_memberships.profile`, and before #638 a profile save replaced that JSON with only the fields it knew. So #638 has to be live before the care contacts API ships, and rollbacks stop there once anyone has saved a contact. Rolled back that far, the fields are hidden and come back on rolling forward. Rolled back further, her next name or AI permission save deletes both. The baby's doctor is in `details`, which keeps keys it doesn't know, and survives either way.

### Rehearsal gate: `BABY_FAMILY_TEST_USERS`

Comma-separated application user ids. While it's set, only those accounts can create, preview or accept an invite or answer the phone check; everyone else gets the same `404` as invites off. A client-3 bootstrap says `family_available: false` for them, so the next build hides the Family row. A build from before that field still shows the row, and its invite requests get the `404`. Someone already in a family keeps the row and everything in it, except making new invites. Unset or blank changes nothing. It's only a rollout gate.

Set it in the Render dashboard before step 2 and leave it out of `render.yaml`, because this repository is public. Blank fails open, so after each deploy that changes the service's env check that a synthetic account not on the list still gets `family_available: false`. Clear it at F10, once the rehearsal has passed and both real phones are confirmed.

### Which client level a build sends

The API decides. With `BABY_FAMILY_ENABLED` off it treats client 3 as a legacy client (no calendar, v1 kinds), so a family-capable build can't simply send 3. Bootstrap is the one request that always goes as client 3: it answers the same either way, and lists `spaces` only with the flag on. Every other request follows the bootstrap this phone holds: no `spaces`, client 2, the 15-second care timer and no `/changes`; `spaces`, client 3, `X-Baby-Space` on writes, and `/changes` in place of the timer. A build therefore works on both sides of the flag and takes up a flip on its next bootstrap, and client 2 still reads and writes the personal space in the seconds until then. Turning the flag off again drops a phone back to client 2 on its next bootstrap; family rows stop being readable, which is why rollback goes through `BABY_INVITES_ENABLED` instead.

### F7a recovery and F10 phone-update gate

The API can't see sessions, but it can see clients. Every `POST /bootstrap` or credential request from a client below 3 records `older_client_at` on the membership under the owner lock, flag on or off, and takes back any readiness and any confirmation. `GET /bootstrap` stays read-only, and builds 34 and 35 open with the POST. If recording fails the request still succeeds, and the phone is seen on its next one. Separately, a credential requested as client 3 notes that installation in `family_phones`, and an unrevoked credential not noted is `outdated`, or `unknown` once expired. A sighting in the last 14 days, or any such credential, refuses the first invite, and accepting an invite, with `409 {detail: {code: "phones_not_ready", ready, phones, older_client_at}}`, before anything moves. `GET /family/readiness` gives the app the same answer. `POST /family/phones/confirm` is her answer: that phone is updated or gone. It revokes credentials that aren't ready, and holds until the next sighting. Later invites aren't gated, because only the first moves rows. An older phone that taps a row which has since moved to a family gets `503 {detail: {code: "update_required"}}` with `Retry-After`. Builds 34 and 35 read a 404 or 409 there as removed and drop the tap; they keep and retry a 5xx, so it stays on the phone and goes through after the update. None of this proves every phone is updated, so F10 keeps a person check: Leon and Kami confirm both phones by eye.

| Plan row | Required acceptance |
|---|---|
| F7a | Retry outbox items previously marked as errors after a 404 so the server can return `moved` and the client can retarget them. A feed/session tap that receives 404 must remain durable; refresh or resolve the record and retry the same action ID instead of deleting the local record and losing the tap. On a capture 401, refresh the share credential and rebind pending captures non-destructively; preserve the original capture ID and receipt. After leave/removal, Keep in my personal space preserves the draft text but drops retired/unreadable attachment IDs and asks the user to reattach the files. |
| F10 | Clear `BABY_FAMILY_TEST_USERS`. Before a real Create family, verify that every signed-in phone has updated to the family-capable build and rebound its share credential. Enforce this as an admission gate, not disclosure copy alone; block family activation while any phone is outdated or its readiness is unknown. Rehearse queued edits/imports, 404-error recovery, a pending feed/session tap and 401 capture recovery across two signed-in phones before admitting real accounts. |


### November 7: mixed parent/baby urgent replies

Follow-up to #642, based on main `d51539e09b2ca03a9848478878506eec87f0ef05`:
Ask must keep both people's fixed guidance when maternal and infant concerns
coexist. Classify patient clauses before combining routes, including “I”, “Im”
and no maternal subject. Baby 911 leads; otherwise maternal immediate-care/911
precedes baby ER or doctor. The same three composite internal routes exist in
the model question check and generated-safety schema on both Ask paths. Existing
mobile Help values and the existing sourced reply text remain compatible.

Acceptance: Leon’s three reproductions plus ten more mixed phrasings; exact
shipped text/order on both HTTP paths with AI/consent off; saved-chat roundtrip;
model-selected composite routes and generated safety labels; and single-person,
lookup, fetal-movement and fragmented-temperature regression checks. This is API
routing QA; no native UI or production service/configuration was changed.
CDC Hear Her and AAP’s newborn illness guidance were re-fetched November 7.

A preliminary real check of the first mixed prompt covered the 13 mixed phrases
and three single-patient controls, three trials each: 48/48 model routes correct,
no provider errors, additional estimated usage $0.005141 under a $0.05 hard cap.
This is targeted evidence, not a full safety/whole-Ask acceptance run. Including
prior completed usage, recorded successful eval usage is $0.333867; including
all earlier conservative incomplete/interrupted reservations, accounted spend
was initially reserved at most $1.933867. The original 401 log proves the first
provider call was rejected before any successful response, releasing its $0.50
reservation. Further final-prompt safety/whole-Ask runs remain inside the
original $2 including conservative reservations for other unfinished runs.

The independent M1–M8 re-check added R1–R5. This hotfix restores the doctor's
911 fallback (R1), preserves both patients (R2), expands AAP emergency phrases
including passing out/choking and prolonged seizures (R3), and routes infant
breathing trouble and green vomit to ER (R4). The model question check, old
Ask generation and V2 share one baby-tier rule. The independent probe files
and report form a 152-phrase regression table, exercised on both HTTP paths.
Exact-route grading now rejects an urgent reply from the wrong tier; floor
coverage also requires the correct fixed reply when a case names a route.
Pregnancy movement concerns remain maternal and survive a separate newborn's
illness. The app remains private; no clinician review is claimed.

Reverified November 7, 2026: AAP [Breathing Trouble](https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Breathing+Trouble),
[Newborn Illness](https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Newborn+Illness+-+How+to+Recognize),
[Fever 0–12 Months](https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Fever+%280-12+Months%29),
and [Febrile Seizures](https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/Febrile-Seizures.aspx).
The conservative default for a baby with unspecified age and breathing trouble
is ER. Choking over-triage is retained; no treatment instructions or dose added.
#639 and #640 remain unmerged; integration and R5 follow the hotfix.
No production configuration or V2 flag change is authorized here.

### November 7 re-check integration and private API configuration

R1–R4 from the independent medical re-check are integrated from the standalone
hotfix into this held API branch. Main's two conflicts retained the reviewed
branch's guards before the newer hotfix was integrated. Poisoning never drops
an independent maternal or infant warning: the fixed replies preserve both
people and Poison Control, with baby 911 first and maternal immediate-care/911
before baby ER/doctor. Model-selected and generated composite labels use the
same fixed replies. No diagnosis, dose or home treatment was added.

The API normalizes mobile's `private-family` to `private_family`. Unknown or
empty explicit audience values become `disabled`, so Baby AI fails closed
without crashing the shared Recipes/Workouts service. Omitted audience remains
`public`, which still needs the review marker plus both public release records.

For Leon to configure private use on Render after review (not changed by this task):

- `BABY_HEALTH_RELEASE_AUDIENCE=private_family` (underscore preferred; hyphen accepted).
- `BABY_HEALTH_REVIEWED_VERSION=baby-health-2026-11-07-m1-m8` acknowledges the dated agent review at Leon's direction, never clinician approval.
- `BABY_HEALTH_PRIVATE_USERS` is a comma-separated list of Leon's and Kami's stable application user IDs, not Clerk subjects. Empty denies everyone.
- Keep `BABY_ASK_CLINICIAN_APPROVAL` and `BABY_WHO_CHART_PERMISSION` empty for this private use. Public or paid use requires actual clinician review and WHO chart permission; the mobile public build gate also remains closed.
- Leave `BABY_ASK_V2_ENABLED` unset until the final safety/whole-Ask evidence and independent review are accepted, the family binary is installed, and deployed consent/access/source/budget/revocation checks pass. No production setting or flag was changed here.

R5 extends Help on the mobile branch with choking on an object and passing out
under 911, and any breathing trouble under one year under ER. Existing urgent
phone actions remain first. The family build must stay internal to TestFlight;
it uses agent-reviewed information and must not be submitted as a public app.

### Current R1–R5 validation and remaining acceptance

The standalone #643 hotfix is integrated, including the final distinction
between maternal self-reports and observations of the baby's symptoms. Both
people's guidance and poisoning guidance survive; emergency order is covered
on the old and V2 HTTP paths. The general choking model case is non-urgent;
the floor retains its conservative emergency response. Latest affected runs
passed 115 standalone and 131 integrated tests.

The full combined disposable-database gate passed on code/test head
`83302dc8db0be6c4161f9a1a1925ac6d05d180f3`: API 6,698 passed/47 existing skips,
Baby 2,857 passed, plus repository TypeScript, Doctor, build/export and native
bundle checks. The standalone hotfix API passed 6,605 tests/47 existing skips;
its final unchanged Baby stage was resumed after installing its missing local
dependencies. No source or prompt was changed for that environment repair.

The paid integrated safety run completed 1,590 checks. Corrected grading and a
saved-verdict replay of the final code give 2.5% model misses, zero misses after
the floor, no model false alarms/errors and 1.4% floor false alarms. This replay
is not another independent run. Seven post-freeze worker-authored holdouts
passed 21/21 model checks. Whole Ask completed 57/58; the two research failures
are fixed, but `crosscheck_movement_general` still produces a guard replacement
that fails the expected general response. Keep V2 off. Recorded successful
eval usage totals $0.553873; including all unresolved earlier ceilings, the
upper bound is $1.653873, inside the original $2. No further paid calls.

R5 source/mounted-screen checks passed, but its new native matrix is blocked:
the isolated iOS 18.5 QA app asserted in native Clerk.configure before health
UI. The advised relaunch failed again, requiring device automation to stop.
No new R5 native dimension passed; iOS 26.5 was not run after that stop. Prior
native passes remain evidence only for their recorded pre-R5 build. The app,
API/Metro and owned simulator were cleaned; the lock was released. Resume
native QA only after resolving that startup block, with the specified stock
devices and a fresh noclobber lock. The protected devices remain untouched.

Final-head review, the native matrix, the remaining whole-Ask case, an internal
family binary and deployed consent/access/revocation/source/budget checks remain
before the V2 flag. The historical `whole-ask-v11-final.json` run used
`baby-ask-v2-5-recheck`; its exact clean source revision was not captured. Do not
attribute that paid run to the canonical `83302dc8` gate or later floor changes;
it is historical regression evidence, superseded by the dated V2 v6 run below.
No PR was merged and no production configuration was
changed by this worker. The full item ledger, primary-source decisions,
conservative defaults and evidence are in #640's medical review report.

### November 8 continuation after #643

Latest acceptance (November 8): Leon reports the R5 native matrix passed on
#640 after Settings layout fix `c26d9e24` and accepts static-content visibility.
That accepted UI is preserved during the API rebase; the blocked attempts below
are historical. Leon set private-family release settings on Render without a
deploy; this worker has not accessed or changed production. V2 stays off until
its complete whole-Ask eval passes (the latest 57/58 run still fails teething).

The final review strengthens the code-only movement floor for reduced-movement
reassurance, split clauses, late-pregnancy decline and texting forms; safe
conditional warnings and negated claims retain their existing protections. Both
Ask paths replace unsafe drafts before the model safety check, with Help and
no proposal. The old generation prompt now lists all fixed-reply labels from the
shared catalog (`baby-chat-reviewed-v7-safety-labels`). Checker/V2 prompts and
clinical routing text are unchanged. A later review also caught a toddler being
treated as fetal in pregnancy context and reassurance in a relative clause
("Kicks decrease, which is normal"). Born-child words/ages now preserve the
baby emergency tier locally and carry a known born child into subsequent
he/she clauses, without converting a separate explicit fetal concern.
Relative-clause reassurance is stopped before the
model check on both Ask paths. Future or negated birth wording (for example,
“due to be born soon” or “not yet born”) now establishes pregnancy context
without marking the baby as born. Explicit newborn/infant/toddler and age
context stays intact, including mixed fetal and born-child concerns. Ten
regression rows cover the distinction on the floor and both HTTP Ask paths. The regression table covers both HTTP paths
and stored replies. AAP child weakness/immobility guidance was rechecked
November 8 at https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Weakness%2Band%2BFatigue.
Schema/catalog parity and literal composite
Help-route expectations cover the smaller review findings. The immediate-care
warning remains based on CDC HEAR HER, rechecked November 8:
https://www.cdc.gov/hearher/maternal-warning-signs/index.html. No new paid calls.

Leon merged #643; #639 and #640 remain held. The API branch now includes the
merged main without conflicts, and the mobile branch includes that API branch.
Do not retarget #640 until #639 is actually merged by its owner.

The generation prompts now distinguish a general late-pregnancy movement question
from a report of a current decrease. The explicit reduced-movement ban and the
urgent floor remain. The old prompt explicitly asks for its `safety` field.
A bare week count or a born baby's kick cannot establish fetal context; when a
week count makes a motionless baby's context ambiguous, preserve baby 911 and
maternal immediate-care guidance. Postpartum infant immobility retains baby 911.
Conversation rename/delete remains available to a current V2 client when release
access is revoked, subject to the original feature flag, ownership and generation
checks; this does not grant permission to generate a health answer.

The earlier native attempt was blocked: the old crash's simulator log confirms Clerk
Keychain OSStatus -34018 (missing entitlement), not an invalid-key diagnosis.
The new isolated ARM64 build used the same development publishable key as the
working Settings bundle and explicit expanded signing entitlements, but iOS 18.5
denied launch (SBMainWorkspace / nested NSPOSIXErrorDomain 153). No new Clerk
crash was observed. Device automation stopped after the advised relaunch failed;
the R5 matrix and cold-relaunch acceptance were not passed in that attempt.
No iOS 26.5 run was attempted then. Leon's later acceptance above supersedes
that block; do not infer acceptance from the older matrix.

Before enabling V2, require a **complete passing final whole-Ask evaluation**,
not only an isolated rerun of the formerly failing movement case, plus the full
required native matrix, final review, reviewed internal family binary and isolated
deployed consent/access/revocation/source/budget checks. Leave the production
flag unset. No production configuration was changed by this task.

The final paid V2 run uses `baby-ask-v2-6-movement-context`: movement education
passed, but the **complete whole-Ask run is 57/58**, with the general teething
answer replaced by a safety refusal. The cause of that refusal is not established
from the privacy-bounded report; do not treat it as a passing complete eval.
The safety check retained 1,590 verdicts: 3.53% model-only misses, zero misses
after the fixed floor, zero model false alarms/errors, 1.4% floor false alarms.
A zero-call replay verifies the final floor; all 588 existing eval inputs have
unchanged floor outcomes. Old generation's explicit safety field is capture-tested
and has not been separately sampled live. No further paid calls will run: recorded
spend/reservations are $0.772048; the conservative entire-task upper bound, keeping
earlier unresolved caps, is $1.912048 of the $2 ceiling. At that snapshot native acceptance and
final review remained gates regardless of test/CI counts. The detailed dated ledger
and raw/replayed evidence are in the held content PR's medical report.

Combined canonical `./scripts/check.sh` passed on code/test head
`55be9ace245807c3bca8d68eb7cc93fbaf5f4d6b` (API source
`77e52ff383b413440cb43c1ae5d0d3170b623eca`): 6,738 API tests passed, 47 existing
skips; Baby 2,857/141 files, Recipes 1,610/201, Admin 14/4, Workouts 1,901/122
plus one existing skip. TypeScript, Doctor 21/21, runtime audits, web checks,
all-platform exports and native-bundle checks passed. The gate used an owned
PG16 UTF-8/C.UTF-8 disposable database with the synthetic postgres role and no
global SSL override. This is automated acceptance, not native UI acceptance.
That isolated native build never reached a health screen; its requested R5 matrix
dimensions and cold relaunch were blocked/not run, before Leon's later acceptance.
No merge, production setting change or flag change was performed by this worker.

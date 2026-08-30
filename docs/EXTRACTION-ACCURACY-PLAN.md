# Håfa Recipes Extraction Accuracy Plan

Created: 2026-08-30  
Product context: [PRODUCT-AND-SYSTEM.md](./PRODUCT-AND-SYSTEM.md)  
Roadmap: [IMPROVEMENT-ROADMAP.md](./IMPROVEMENT-ROADMAP.md)

## Decision

Håfa Recipes will treat an imported recipe as a reviewable draft until its
cooking-critical fields are supported by the source or explicitly verified by
the user. The system must not make an incomplete recipe look complete.

The owner can always keep the source and whatever was extracted as a private,
editable draft. Readiness controls warnings, public publishing, and which
cooking action is emphasized; it never prevents saving, organizing, or manually
completing the recipe.

The product-level contract is:

> Preserve what the source says, identify what it does not say, and make every
> cooking-critical uncertainty easy to review before shopping or cooking.

This work has priority over broader social features and advertising inside the
cooking workflow.

## Confirmed failure modes

The production and local review found failures at four different layers. They
must be fixed as a system; changing only the model will not solve them.

### Source acquisition

- A normal social-video import uses the caption/metadata and spoken audio, but
  it does not inspect normal video frames. Recipes that communicate ingredients
  through packages, actions, or on-screen text are therefore incomplete.
- TikTok photo/slideshow imports fetch the slideshow images but discard the
  post caption, even when that caption contains the complete typed recipe.
- The current local TikTok audio path is missing the browser-impersonation
  dependency now required by some TikTok requests. A failed download can reduce
  an import to a title and hashtags.
- Metadata-only input is not enough evidence from which to construct a recipe.
  It should fail honestly or request another input, not ask a model to fill in
  the dish from a title and hashtags.

### Extraction policy

- The normal video prompt contains both a null-when-missing rule and an
  instruction to make reasonable assumptions. That is an ambiguous trust
  boundary.
- Servings and some times are estimated without being represented separately
  from source-stated values.
- The application uses legacy JSON mode rather than a strict recipe/evidence
  JSON schema.
- A larger fallback model cannot recover evidence that caption, audio, OCR, or
  frame analysis never collected.

### Confidence and persistence

- Recipe-level confidence does not reliably detect missing quantities,
  temperatures, cook times, or step gaps.
- A recipe can contain many blank amounts while remaining marked high quality.
- A full recipe edit rebuilds the recipe JSON without `lowConfidence` or
  `confidenceWarning`, so editing any part of a recipe clears its warning.
- A single recipe-wide flag cannot tell the user which fields need attention.

### Product flow

- URL imports are created—and can currently be requested as public—before the
  user sees an editable review screen. Creating a private draft is acceptable;
  presenting or publishing it as finished before review is not.
- The recipe page shows a generic warning rather than the actual reason and
  gives `Start Cooking` more emphasis than `Review and fix`.
- OCR import assumes every image is a printed or handwritten recipe. A plain
  food photo can therefore be treated as extraction evidence even though it
  contains no recipe text. Generating an inspired recipe from a dish photo is a
  different feature and must be labeled as such.
- Current version history records edits, but it does not distinguish extraction
  corrections from later recipe customization.

## Trust contract

These rules apply to every importer and every model:

1. Cooking-critical facts must be source-supported or user-verified.
2. Missing, cropped, silent, or unreadable information stays missing.
3. `To taste` is used only when the source explicitly communicates preference.
   An unstated amount is `Not stated — verify original`.
4. Estimates are allowed only in clearly derived fields and must be labeled
   `Estimated`. They never masquerade as source facts.
5. No metadata-only recipe generation. Offer caption paste, screenshots, manual
   entry, or a clear failed-import state instead.
6. A warning persists until every affected field is corrected, removed, or
   explicitly verified. Editing one field does not clear other warnings.
7. Every import can be kept as a private, editable draft, including a source the
   automatic extractor could not turn into a usable recipe.
8. A draft cannot be published to Discover until its cooking-critical fields
   are source-supported or user-verified.
9. A user may cook from an incomplete draft after a clear warning. If there are
   no instructions, the app keeps Cook Mode unavailable and explains what must
   be added first.
10. User changes made during initial review are extraction corrections. Changes
   made later are customization unless the user explicitly reports an import
   problem.
11. Saving an incomplete edit or re-extraction never discards the owner's work.
    If the previous revision was public, the incomplete revision becomes
    private and the previous version remains restorable.
12. A failed re-extraction never overwrites the existing recipe. It leaves the
    current content and visibility unchanged and offers retry or manual editing.

## Target extraction pipeline

```text
Source URL / screenshots / text
              |
              v
      1. Acquire every available modality
         caption + metadata + audio + frames + images + website data
              |
              v
      2. Classify the input
         recipe document / social video / slideshow / website / dish photo
              |
              v
      3. Extract evidence by modality
         transcript spans + caption spans + OCR boxes + frame timestamps
              |
              v
      4. Reconcile into a canonical recipe draft
         strict schema; no unsupported cooking-critical facts
              |
              v
      5. Run deterministic completeness and conflict checks
              |
              v
      6. User reviews highlighted fields beside the original source
              |
              v
      7. Keep as a private draft; mark ready after review
         and record correction telemetry
```

### Social video acquisition

- Fetch the complete public caption before attempting audio.
- Repair the yt-dlp runtime with supported impersonation dependencies and a
  JavaScript runtime, then add a public-fixture canary for every supported
  platform.
- Transcribe spoken audio when available.
- Add frame analysis for normal videos. Use scene changes, the opening/closing
  segments, and periodic text-bearing frames rather than sending every frame to
  a vision model.
- Run OCR on candidate frames, deduplicate repeated overlays, and retain the
  frame timestamp as provenance.
- If the platform blocks acquisition, stop and offer `Paste caption`, `Add
  screenshots`, `Enter manually`, or `Save source as draft`.

### TikTok slideshow acquisition

- Return caption, author metadata, images, and their ordering from one source
  adapter.
- Treat the caption as the primary structured text when it contains a recipe.
- Use images to fill demonstrated steps or text overlays, not as a substitute
  for a complete caption that was already available.
- Surface conflicts between caption and image text for review instead of
  silently selecting one.

### Photo and screenshot acquisition

- Classify images before extraction:
  - recipe document/screenshot;
  - multi-page recipe;
  - dish/ingredient photo;
  - unsupported or unreadable image.
- OCR only the document modes.
- A dish photo should offer a separate `Create an inspired recipe` action with
  an explicit generated-content label. It must never be described as an
  extraction of the pictured recipe.
- Preserve page, bounding-box, and OCR-quality references long enough for the
  review screen; do not expose private source artifacts publicly.

Implementation status: the default-off classification gate and mobile recovery
copy are implemented. It deliberately stops before the separate inspired-recipe
concept. Production rollout remains gated on the canaries and measurements in
[IMAGE-INPUT-CLASSIFICATION-RUNBOOK.md](./IMAGE-INPUT-CLASSIFICATION-RUNBOOK.md).

## Save and recovery behavior

Recipe readiness and save permission are deliberately separate.

| Review state | What happened | Save and edit | Cook | Publish to Discover |
|---|---|---|---|---|
| `source_incomplete` | The source was inaccessible, not a recipe, or too incomplete for a useful automatic extraction | Always allowed as a private draft | Allowed only after at least one instruction exists, with a warning | No |
| `needs_review` | A useful draft exists, but cooking-critical fields are missing, inferred, ambiguous, or conflicting | Always allowed | `Cook with draft` remains available after confirmation | No |
| `ready` | Cooking-critical fields are source-supported or user-verified | Always allowed | Normal `Start Cooking` flow | Yes, after the existing disclosure |

The user-facing label for `source_incomplete` is `Source incomplete`, not
`Blocked`. The recovery screen should say what was unavailable and offer:

1. `Add screenshots or caption`;
2. `Enter recipe manually`;
3. `Save source as private draft`;
4. `Try again` when the failure is retryable.

A source-only draft stores a best available title, source URL and thumbnail when
available, source type, and empty recipe sections. Do not insert placeholder
ingredients or instructions that could be mistaken for real cooking content.
The owner can save partial edits; completeness validation moves from the generic
edit endpoint to the transitions that mark a recipe ready or public.

URL drafts retain the original URL. The application currently treats uploaded
screenshots and pasted text as transient extraction inputs. This project must
not silently change that privacy contract. The save screen should disclose when
the original input will not be attached. Persisting private source images can be
a later opt-in feature after signed access, retention, export, and deletion are
designed and tested.

An extraction job's technical state remains separate from recipe readiness.
Existing job statuses stay unchanged so deployed mobile versions do not poll
forever on an unknown status. A failed job can expose an additive
`can_save_draft` capability, and an idempotent, owner-scoped endpoint can create
the source-only draft on request.

## Backward-compatible evidence model

Keep the existing recipe values so older app versions continue to work. Add a
nullable `review_state` column for filtering and server enforcement plus a
parallel, versioned evidence object rather than wrapping every value. Existing
recipes remain unchanged and a null state is handled as a legacy recipe.

```json
{
  "review_state": "needs_review",
  "content_revision": 3,
  "uncertainty_count": 2,
  "extraction_evidence": {
    "version": 1,
    "contentRevision": 3,
    "source": { "type": "tiktok", "method": "whisper" },
    "assessment": {
      "ingredientCount": 4,
      "stepCount": 5,
      "missingQuantityCount": 1,
      "uncertaintyCount": 2,
      "userReviewed": false,
      "reasons": [
        "The imported details have not been verified by a person yet.",
        "1 ingredient quantity is not stated."
      ]
    },
    "fields": [
      {
        "path": "components.0.ingredients.2",
        "status": "not_stated",
        "quantityStatus": "not_stated"
      },
      {
        "path": "components.0.steps.3",
        "status": "supported"
      }
    ]
  }
}
```

Allowed field statuses:

- `supported`
- `not_stated`
- `user_verified`

Recipe-level states are computed by the server:

- `source_incomplete`: automatic extraction could not produce a useful draft,
  but the owner can keep the source and complete it manually;
- `needs_review`: at least one cooking-critical field is ambiguous, inferred,
  missing, or in conflict;
- `ready`: every cooking-critical field is source-supported or user-verified.

Field paths are tied to a content revision. Every full recipe edit increments
that revision and recomputes or remaps evidence in the same transaction so a
reordered ingredient cannot inherit a stale warning. Stable per-field IDs are
not required for the first release unless the edit-diff tests show that revision
and value matching are insufficient.

For compatibility, the API continues returning the existing recipe shape and
derives `lowConfidence` and `confidenceWarning` from the new state for older
mobile versions. New fields are optional and additive. No existing value is
wrapped, renamed, or removed.

Do not treat a model's self-reported numeric confidence as authoritative.
Recipe state comes from evidence availability, deterministic validation, and
measured calibration on the evaluation set.

## Review experience

Every URL, photo, and pasted-text import should end in the same draft review
surface. A private draft can already exist so the user does not lose the import;
the review action confirms readiness rather than granting permission to save.

- Show `Ready to review`, not `Recipe complete`, when extraction finishes.
- Put the exact number and type of uncertain fields at the top.
- Highlight uncertain quantities, units, temperatures, times, servings, and
  steps inline.
- Use plain labels: `From source`, `Estimated`, `Not stated`, and `You verified`.
- Keep the original video, caption, or page reachable beside the affected
  fields. Use timestamps or page references when available.
- Primary action for uncertain recipes: `Review 4 fields`.
- Secondary action before persistence: `Save as private draft`. If the async
  flow already created the draft, show `Saved privately` and use `Done for now`
  instead of pretending another save is required.
- Do not show `Start Cooking` as the primary action until the recipe is ready.
- Keep `Cook with draft` available for a recipe with instructions. Confirm that
  unresolved details may be inaccurate before entering Cook Mode.
- Publishing requires a ready recipe and the existing publishing disclosure.
- Let owners save incomplete manual edits. Show what is still needed to reach
  `ready` without discarding their work.

When a user edits an existing uncertain recipe, recompute the remaining field
evidence. Only changed fields become `user_verified`; unrelated warnings remain.

Readiness must also follow the recipe into downstream features:

- grocery and scaling surfaces retain missing quantities as `Not stated`
  instead of inventing a number;
- recipe chat receives the review state and unresolved-field summary and must
  distinguish source facts from suggestions;
- planner, history, and collection cards may contain private drafts and show a
  compact `Needs review` label where it helps the user act;
- re-extraction and version restore recompute readiness before changing public
  visibility;
- public sharing, Discover, and public API responses never expose a newly
  incomplete revision.

## Evaluation and release gates

The current five-case synthetic benchmark is insufficient. Build a private,
redacted dataset from permissioned production failures plus public fixtures.

The first useful dataset should cover at least:

- caption-complete social posts;
- speech-complete videos;
- on-screen-only quantities;
- silent/music-only demonstrations;
- inaccessible/private/deleted posts;
- TikTok slideshows with complete captions;
- slideshows with image-only instructions;
- multiple recipes in one post;
- printed, handwritten, cropped, blurry, and multi-page recipes;
- plain food photos that must not be treated as OCR sources;
- Guam and Chamorro dishes, multi-component recipes, baking, brines, and other
  quantity-sensitive cases.

Score at the field level:

- ingredient name precision/recall;
- exact quantity and unit match when the source states them;
- step coverage and ordering;
- temperature and time accuracy;
- unsupported cooking-critical claim count;
- uncertainty precision and recall;
- false-ready rate;
- correction count required before cooking;
- acquisition success by platform;
- latency and cost per reviewed recipe, not merely per model response.

Initial release gates:

- zero unsupported cooking-critical facts on the must-pass safety set;
- at least 95% recall for intentionally missing or ambiguous critical fields;
- no metadata-only source may reach `ready`;
- every supported-platform canary must pass or the platform is shown as
  degraded;
- the review flow must preserve warnings through partial edits;
- model changes must beat the current baseline on the same cases without an
  unacceptable cost or latency increase.

After release, compare correction rate, time-to-ready, import abandonment, and
30-day retention against the pre-change baseline. Store only structured field
diffs, source type, model/prompt version, and status—not private recipe text—in
analytics.

## Implementation and safe rollout plan

Each release unit is independently testable and deployable. Later units depend
on the contracts established earlier; do not combine the whole project into one
large migration or mobile release.

### Implementation status — 2026-08-31 (Pacific/Guam)

- Release 1 and Release 3 are live in production. New imports have durable,
  deterministic review state and evidence; incomplete or failed imports can be
  kept privately and edited; publish, edit, re-extraction, and restore paths
  enforce the same readiness contract without rewriting legacy rows.
- The server-integrity portion of Release 2 is implemented in the current
  extraction-integrity change: strict Structured Outputs for every recipe model
  path, no-invention prompts, slideshow caption evidence, metadata/music-only
  rejection, null-preserving uncertainty checks, the strict website fallback,
  and the supported yt-dlp impersonation dependency.
- Public platform canaries, field-level evaluation expansion, normal-video frame
  rollout, a complete side-by-side editor, and correction telemetry remain
  explicit follow-up work. The normal-video frame
  path is implemented behind a default-off server flag with bounded download,
  sampling, deduplication, timestamp provenance, conservative reconciliation,
  and cleanup tests. It stays off until public canaries establish acquisition,
  latency, and cost behavior on the deployed runtime.
- The owner recipe screen now makes review—not cooking—the primary action for
  incomplete and unverified drafts. It shows the exact missing-amount count,
  privacy-bounded source modalities/frame timestamps, an original-source link,
  and keeps `Cook with draft` as a warned secondary action when instructions
  exist. Broader time/temperature highlighting belongs in the field-evidence
  expansion rather than being inferred in the client.
- Full recipe edits now write transactional, count-only correction events that
  distinguish initial review corrections, unchanged human verification, and
  later customization. The schema deliberately excludes recipe values, raw
  source content, URLs, and field paths; see
  [CORRECTION-TELEMETRY.md](./CORRECTION-TELEMETRY.md).

### Release 0 — Lock the baseline before changing behavior

- Turn the confirmed failures into redacted, permissioned regression fixtures.
- Expand the eval runner to score fields, unsupported facts, uncertainty, and
  acquisition success rather than only whole-response similarity.
- Add tests that capture the current API response used by the latest production
  mobile build and at least one still-supported older build.
- Establish correction rate, false-ready rate, extraction success by platform,
  latency, and cost baselines.

Exit gate: all known failure modes reproduce without production data, and every
later prompt, model, or acquisition change can be compared with the baseline.

### Release 1 — Add state and evidence without changing the user experience

- Back up production and establish a Neon restore point.
- Add nullable `review_state`, evidence JSON, and content-revision storage. Do
  not rewrite existing rows or add a non-null constraint in this release.
- Add optional state/evidence fields to detail, list, extraction-job, and edit
  responses. Preserve the existing recipe JSON and confidence fields.
- Centralize the server-side readiness calculation and make it deterministic.
- Dual-write the old confidence fields and the new state for newly extracted
  recipes while the feature remains dark.
- Recompute evidence in the same transaction as an edit or version restore.

Exit gate: the current production mobile app behaves exactly as before against
the new API; new state is observable in tests and internal diagnostics only.

### Release 2 — Stop the known unsupported extraction paths

- Remove the prompt instruction to make assumptions about cooking-critical
  fields and move model output to strict Structured Outputs.
- Include TikTok slideshow captions and metadata in the slideshow adapter.
- Repair the yt-dlp impersonation/JavaScript runtime and add public canaries for
  TikTok, Instagram, and YouTube acquisition.
- Refuse to manufacture a recipe from a title, hashtags, or unrelated music.
- Add deterministic checks for missing amounts, temperatures, times, step gaps,
  inaccessible modalities, and cross-source conflicts.
- Keep all changes behind server flags with the old extractor available as a
  rollback path during evaluation. Never use the old metadata-only fallback to
  mark a recipe ready.

Exit gate: the music-only, complete-caption slideshow, and inaccessible-source
fixtures return either an evidence-backed recipe or `source_incomplete`; none
returns a confident invented recipe.

### Release 3 — Make every outcome saveable and editable

- Add an idempotent, owner-scoped `Save source as draft` operation for failed or
  source-incomplete extraction jobs. Repeated requests return the same recipe.
- Store source-only drafts privately, regardless of the original publish
  selection. Do not insert fake ingredients or instructions.
- Allow recipe owners to save partial edits. Move the current “at least one
  ingredient and instruction” requirement to ready/public transitions.
- Keep user edits authoritative and mark only changed or explicitly accepted
  fields as `user_verified`.
- Require readiness in every server path that can publish to Discover. Keep the
  existing publishing disclosure as a separate requirement.
- Recompute readiness after edits, re-extraction, original/version restore, and
  manual creation. Save incomplete changes privately; never reject and discard
  the owner's work merely because a public recipe became incomplete.
- Leave the current recipe untouched when re-extraction cannot produce a useful
  candidate. A successful but uncertain re-extraction creates a version
  snapshot, updates the owner-visible draft, and removes it from Discover until
  reviewed.
- Make grocery, scaling, chat, and Cook Mode code tolerate empty or partial
  components without crashing or inventing defaults.

Exit gate: a user can keep and later complete every supported source; partial
edits never clear unrelated warnings; incomplete drafts cannot become public.

### Release 4 — Ship the mobile review and recovery experience

- Replace success alerts with one shared review surface for URL, image, and text
  imports while preserving the current capture-review behavior.
- Show `Source incomplete`, `Needs review`, or `Ready` with a plain explanation
  and exact uncertain-field count.
- Highlight affected fields and link back to the source or its timestamp/page
  when retained.
- Provide `Add screenshots or caption`, `Enter manually`, `Save source as
  private draft`, and retry actions where applicable.
- Make `Review fields` primary for uncertain recipes. Keep `Cook with draft` as
  a secondary, confirmed action when instructions exist.
- Test keyboard, screen reader, Dynamic Type, contrast, 44-point targets,
  offline/retry transitions, and reduced motion. Do not rely on warning color
  alone.

Exit gate: a user can understand and recover from every state without losing
their source or mistaking an uncertain recipe for a finished one.

### Release 5 — Add normal-video visual evidence

- Select keyframes using scene changes, opening/closing coverage, and periodic
  text-bearing frames rather than sending an entire video to a model.
- Run OCR, deduplicate repeated overlays, and retain timestamp provenance.
- Reconcile caption, audio, and visual candidates with explicit conflict
  detection.
- Bound temporary media retention and verify cleanup on success, failure,
  timeout, cancellation, and worker restart.
- Measure cost and latency per reviewed recipe before increasing traffic.

Exit gate: on-screen-only fixtures pass the field-level gates with acceptable
cost, latency, and artifact cleanup.

Operational rollout and rollback: [VIDEO-FRAME-EXTRACTION-RUNBOOK.md](./VIDEO-FRAME-EXTRACTION-RUNBOOK.md)

### Release 6 — Classify image inputs and roll out gradually

- Classify recipe documents, multi-page documents, dish photos, and unreadable
  images before extraction.
- Keep document extraction and `Create an inspired recipe` as explicitly
  different modes.
- Run an internal cohort, then an opt-in pilot with Alisa and other frequent
  importers, followed by 10%, 25%, 50%, and 100% rollout gates.
- Stop expansion if false-ready rate, correction burden, acquisition success,
  latency, cost, crash rate, or import abandonment crosses its guardrail.

Exit gate: the new pipeline improves measured correction burden without a
privacy, reliability, cost, or supported-mobile-version regression.

## Compatibility and rollback rules

- Deploy additive database and API changes before the mobile UI that consumes
  them. Unknown response fields must remain safe for older clients.
- Do not add a new extraction-job status until every supported client treats it
  as terminal. Use additive capabilities such as `can_save_draft` instead.
- Preserve existing `extracted`, flattened ingredient/step fields, confidence
  fields, recipe IDs, ownership, visibility, and version history.
- Keep legacy null `review_state` behavior explicit. Do not silently mark all
  historical recipes ready or not ready.
- Put strict extraction, new evidence, source-draft recovery, review UI, frame
  analysis, and publish enforcement behind separately reversible flags.
- Roll back behavior through configuration first. Additive columns can remain
  unused; rollback must not require a destructive down migration.
- Test the latest and still-supported older App Store versions against the new
  API before each enforcement flag is enabled.

## Required test matrix

- Unit: source classification, deterministic readiness, evidence revision,
  missing-field detection, conflict detection, and `to taste` handling.
- Contract: old and new recipe/job payloads, absent optional fields, legacy
  recipes, and flattened component compatibility.
- Integration: authenticated draft creation, idempotency, cross-user denial,
  partial edits, version restore, publish denial, and eventual ready/public
  transition.
- Extraction: caption-only, audio-only, on-screen-only, music-only, slideshow,
  inaccessible source, website JSON-LD, printed recipe, cropped scan, and dish
  photo fixtures.
- Mobile: all three review states, retry, source-only save, manual completion,
  warning persistence, draft cooking confirmation, empty Cook Mode prevention,
  groceries, scaling, recipe chat, planner, collections, history, public-edit
  unpublishing, re-extraction, version restore, and Discover exclusion.
- Operational: migration on a production-shaped copy, worker retry/cancel,
  temporary-file cleanup, provider failure, timeout, feature-flag rollback, and
  representative cost/latency load.
- Repository: run affected API/mobile suites, the eval report, and
  `./scripts/check.sh` before each pull request is considered ready.

## Production-data handling

- Do not bulk-rewrite existing recipes or ownership.
- Any retroactive audit is dry-run first, idempotent, and produces counts—not
  recipe text—for operator review.
- Existing user edits remain authoritative.
- A safe first retrofit is to compute a non-destructive `needs review` signal
  for obviously missing cooking-critical fields while preserving every saved
  value and version.
- Obtain a database restore point before any production schema migration.

## External patterns reviewed

- ReciMe documents a caption → audio → original website fallback and tells users
  to provide screenshots when source information is inaccessible or incomplete:
  <https://www.recime.app/help/en/articles/14773584-why-didn-t-my-recipe-import-correctly>
- ReciMe's image flow presents a preview for editing before the user finalizes
  the import:
  <https://help.recime.app/getting-started/3hfwkf6GH8hXhESCpg25Le/import-from-an-image/3hfwkf6GH3aqGgBGCAaxn9>
- Flavorish states that accurate social imports require a complete description
  and otherwise fills blanks. Håfa Recipes should improve on that behavior by
  identifying blanks rather than silently filling them:
  <https://www.flavorish.ai/blog/help-center-feature-related>
- Google Document AI exposes field-level confidence and provenance so low-score
  entities can trigger manual review. Håfa should use categorical,
  evidence-backed review states calibrated on recipe evals:
  <https://docs.cloud.google.com/document-ai/docs/custom-extractor-overview>
- OpenAI recommends strict JSON Schema Structured Outputs over legacy JSON mode
  when supported:
  <https://developers.openai.com/api/docs/guides/structured-outputs>
- yt-dlp documents `curl_cffi` as the recommended browser-impersonation
  dependency for sites that use TLS fingerprinting:
  <https://github.com/yt-dlp/yt-dlp#impersonation>

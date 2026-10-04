# Nutrition coverage and existing-recipe repair

Recipe import now runs shared nutrition enrichment before saving. Website nutrition is preserved; otherwise nutrition is estimated from the ingredient amounts. A publisher portion such as “1 cookie” stays separate from recipe servings; it is not multiplied or mixed into estimates for a different portion. Amount assumptions are disclosed. An unstated serving count stays unstated: the app shows whole-recipe totals instead of inventing a serving count. Provider errors leave the recipe saved and offer a retry.

Owners can retry or recalculate with `POST /api/recipes/{recipe_id}/nutrition`, optionally supplying `expected_content_revision`. This updates nutrition only, snapshots the previous content in version history, and rejects concurrent changes. Unsaved edits use `POST /api/recipes/ai/estimate-nutrition`; a null serving count returns whole-recipe totals. Both use the same calculation and validation service.

## Before production repair

1. Verify the production Neon project, branch and deployed API commit. Create and verify a restore point. Record its exact reference.
2. Set `MIGRATION_033_RESTORE_POINT` to that reference before deploying migration 033. The versioned migration runner installs immutable repair plans and audit events; it does not run a backfill.
3. Create and verify a fresh restore point for the recipe repair. Set `APP_RELEASE_ID` to the immutable deployed commit when the runtime does not supply `RENDER_GIT_COMMIT`.
4. Confirm the enrichment model, credentials and expected provider budget. Start with a small page and `--max-estimates 3` or `5`.

The command repairs missing or partial nutrition across private and public recipes. It never changes ownership, ingredient facts, servings, notes, steps, images, visibility, review evidence or content revisions. Complete nutrition is skipped. Incomplete-source drafts and records with no ingredient basis are counted as `ineligible`; they need ingredient corrections before estimation.

## Dry-run twice

From `api/` in the intended runtime:

```sh
python -m app.nutrition_backfill --batch-size 10
python -m app.nutrition_backfill --batch-size 10
```

Dry run makes no writes and no provider calls. Both outputs must have the same `plan_digest`, `database_fingerprint`, `release_id`, `scanned_rows` and `planned_items`. Output contains counts and a keyset cursor, not recipe contents, titles, owner identities or source URLs. `scanned_rows` includes complete recipes; `planned_items` counts eligible missing or partial records.

## Apply the inspected plan

Supply the exact expectations from that output, the verified restore-point reference and a new run ID:

```sh
python -m app.nutrition_backfill \
  --apply \
  --backfill-id nutrition-repair-batch-001 \
  --restore-point verified-neon-restore-reference \
  --expected-plan-digest PLAN_DIGEST \
  --expected-database-fingerprint DATABASE_FINGERPRINT \
  --expected-release-id DEPLOYED_COMMIT \
  --expected-rows 10 \
  --batch-size 10 \
  --max-estimates 5
```

The default repair calculator spaces estimate starts at least seven seconds apart, including across resumed pages in the same process. It retains the normal per-owner request limits and waits outside database transactions. Dry runs never wait or call a provider. Custom operational calculators must provide equivalent pacing.

The provider-call budget applies to one invocation, including retries. The command records an attempt before provider work, so interrupted attempts count toward the default limit of three per recipe. It updates each recipe and records success in one transaction. A session-level advisory lock prevents overlapping repair runs.

The immutable plan binds the database, release, model, calculation version, cursor, page size and each recipe's original content and ownership. Repair calls pin that exact model and disable canary routing; a changed model stops the run as `blocked_model` before any mismatched result can be written. Each write rechecks the recipe under a row lock. Concurrent owner edits or nutrition recalculations cause `blocked_conflict`; no result overwrites the changed recipe, and processing stops.

## Resume and continue

Repeat the exact same apply command and run ID after `budget_limited`, `retryable_failures` or interruption. Successful items are skipped and failed items can retry within `--max-attempts` (1–5). An unchanged run ID cannot be repurposed for another plan, restore point or runtime. Investigate `attempt_limit` rather than repeatedly increasing attempts.

A local request-limit denial records `local_rate_limit` and stops the invocation as `rate_limited`. This denial happens before the provider call. The reported provider-call budget counter is a conservative count of estimate attempts, including such denials. Wait at least sixty seconds after the last enrichment request before resuming the same immutable run; retain all original arguments and budgets. Do not repeatedly resume while a limit is active.

If an older unpaced run exhausted attempts, inspect its bounded audit failure codes and provider invocation ledger first. Some older local denials were recorded as `provider_unavailable`; that label alone does not prove the provider failed. After confirming local-only denials, retain the original audit history and successes, observe the cooldown, verify a restore point and current release, and dry-run twice under a new run ID. A fresh plan skips prior successes and binds the remaining current content. Never automatically increase the attempt limit, remove audit events or reuse an old run ID for a new plan.

A conflict remains blocked for that immutable run. Inspect the changed recipe and take a fresh dry-run plan under a new run ID when ready. Prior successes remain complete and are skipped by the new plan.

After a page finishes, pass its `next_after_recipe_id` to both dry runs and apply for the next page. Give each page a new run ID. A page with zero planned items needs no apply; advance its cursor. Stop when the next page scans zero rows.

Inspect initial results in the app before increasing page size or provider-call budget. Verify decimal macros and zero-valued nutrients, source-supplied nutrition, whole-recipe totals for missing servings, disclosed amount assumptions, preserved recipe edits and retry behavior. Record repaired, failed, ineligible and conflicted counts in the production handoff. Audit tables store immutable plan hashes, recipe IDs, attempts and bounded outcome codes; they do not store ingredient text or provider output.

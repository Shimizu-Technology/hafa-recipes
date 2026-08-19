# Database Invariants and Canonical Sources Runbook

Updated: 2026-08-19
Roadmap scope: B3 — Canonical source and database invariants
Migration: `020_add_database_invariants`

## Why this exists

Application-level “check then insert” logic is not enough under concurrent
requests. Two workers can observe the same empty state, or an account can be
deleted while another request is still writing. Migration 020 moves the core
rules into PostgreSQL so every API replica and worker observes the same
boundary.

The migration is additive and idempotent. Application startup fails before
serving if its tracked migration record, required unique indexes, or validated
ownership constraints are missing.

## Canonical source behavior

External recipes keep a normalized attribution URL and a separate, bounded
`canonical_source_key`:

| Source | Identity rule |
|---|---|
| YouTube | Video ID across watch, short, Shorts, embed, and live URLs |
| TikTok | Video/photo ID, independent of creator slug and tracking parameters |
| Instagram | Post/reel/TV shortcode |
| Website | SHA-256 of normalized host, path, and meaningful sorted query |
| Manual/OCR placeholder | No canonical key; users may create many local recipes |

Fragments and known tracking parameters are removed. HTTP and HTTPS website
variants share an identity key, while the stored attribution URL preserves its
normalized scheme.

The product rule is one external source per application user. Different users
may independently import the same source. Existing same-user duplicates are not
deleted or merged: the earliest row becomes the canonical representative and
the remaining legacy rows retain a null key. New imports and duplicate checks
return the representative.

## Enforced invariants

- `recipes (user_id, canonical_source_key)` is unique when both values exist.
- `saved_recipes (user_id, recipe_id)` is unique.
- `recipe_versions (recipe_id, version_number)` is unique.
- Version numbers are allocated while holding the recipe row lock in the same
  transaction as the version snapshot and recipe mutation.
- Every business-data owner/actor column references `app_users`.
- Owned data cascades when its application user is erased. Historical actor
  fields (`recipe_versions.created_by` and invite `accepted_by`) become null.
- Invite creation rows cascade with their creator, matching account-erasure
  behavior.

The durable deletion intent/tombstone tables intentionally do not reference
`app_users`; their purpose is to survive authoritative local account deletion
until external cleanup completes.

## Deployment

1. Run migrations 016 through 019 as already required.
2. Run `python -m migrations.020_add_database_invariants` as the pre-deploy
   command.
3. Start the API. `verify_database_invariants()` checks migration version 20,
   the three unique indexes, and all 11 validated owner constraints.
4. Verify `/up` and `/health`.
5. Confirm the new deployment is serving the intended commit.

Migration 020 creates `schema_migrations` and records version 20. Earlier
numbered migrations remain idempotent pre-deploy prerequisites; new migrations
must add a tracked version rather than relying only on file naming.

## Verification queries

```sql
SELECT version, name, applied_at
FROM schema_migrations
WHERE version = 20;

SELECT indexname
FROM pg_indexes
WHERE indexname IN (
  'uq_recipes_user_canonical_source',
  'uq_saved_recipes_user_recipe',
  'uq_recipe_versions_recipe_number'
);

SELECT conname, convalidated
FROM pg_constraint
WHERE conname LIKE 'fk_%_app_users'
ORDER BY conname;
```

Expected results are one migration row, all three indexes, and 11 validated
foreign-key constraints.

## Rollback and recovery

Rolling the application back to the previous release is safe: the added column,
indexes, tracking table, and stricter ownership constraints are compatible with
the earlier code. Do not drop constraints or erase canonical keys during an
incident; doing so would reopen the races this migration closes.

The URL normalization performed during backfill is semantically preserving but
is not automatically reversed. Legacy duplicate recipe rows remain present, so
no user recipe content is discarded by the migration.

If startup reports migration 020 is incomplete:

1. keep the prior deployment live;
2. inspect the pre-deploy log and the verification queries above;
3. correct the specific schema failure;
4. rerun migration 020; and
5. redeploy only after the disposable PostgreSQL integration suite passes.

## Test evidence

`test_database_invariants_integration.py` proves:

- idempotent migration execution;
- canonical handling without deleting legacy recipes;
- saved/version duplicate cleanup before constraints;
- all owner constraints validate;
- startup schema verification passes; and
- two concurrent version transactions receive sequential unique numbers.

`test_source_urls.py` covers YouTube, TikTok, Instagram, ordinary websites,
tracking parameters, and manual/OCR exceptions.

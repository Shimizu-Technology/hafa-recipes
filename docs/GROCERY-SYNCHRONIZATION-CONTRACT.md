# Grocery synchronization contract

Status: API foundation implemented; mobile adoption and WidgetKit integration follow in separate releases.

## Why this contract exists

The original mobile client treated checking an item as a toggle. That is unsafe when a request is retried: if the server commits the first request but the response is lost, a retry can immediately undo the change. Adds had the same ambiguity and could create duplicates. The offline queue also had no server change token or stable account/list scope to reconcile against.

The durable contract uses desired state and idempotent mutation IDs. It is additive, so App Store builds that still use the legacy endpoints continue to work while the new mobile client and widget are introduced.

## Read contract

`GET /api/grocery/snapshot` returns one authenticated, authoritative snapshot containing:

- a stable opaque account-scope ID derived from the application account;
- current list ID, membership, sharing state, and monotonic revision;
- all active items and their creation/update timestamps;
- total, checked, and unchecked counts; and
- server time for a visible freshness indicator.

The opaque account scope and list ID are the only valid namespace for persisted mobile or App Group grocery state. The account scope is derived from the stable application user, but does not expose that internal owner ID to the client. A Clerk subject is provider identity context, not a permanent business-data owner ID.

## Mutation contract

`POST /api/grocery/sync` accepts one operation:

- `add`: client-generated item UUID plus item fields;
- `update`: client-generated mutation UUID, item UUID, and explicit changed fields;
- `set_checked`: item UUID plus the desired Boolean state; or
- `delete`: item UUID.

Every request carries the snapshot's `list_id` and a globally unique `mutation_id`. The API rejects a mutation if the account has since joined or created another list, preventing a stale offline action from crossing a household boundary. It stores only a SHA-256 digest of the canonical payload alongside the stable actor ID, operation, list ID, and mutation ID. It never stores a bearer credential or private device secret in the receipt.

The server locks the grocery-list row, checks for a prior receipt, applies the operation, increments the revision, writes the receipt, and constructs the response in the same transaction. A matching retry does not run again. Reusing the mutation ID with another actor, operation, or payload returns `409`.

The response includes `replayed` and the full post-mutation snapshot. Clients replace their local cache with that snapshot before removing the queue entry.

## Compatibility

The original grocery endpoints remain available for old mobile versions. Their item writes now acquire the same list lock and increment the same revision. The legacy toggle endpoint remains non-idempotent and must not be used by the new offline queue or widget.

## Database invariants

Migration 023 is additive and idempotent. It adds:

- `grocery_lists.revision`;
- one-membership-per-user uniqueness on `grocery_list_members.user_id`; and
- `grocery_mutation_receipts` with list/user foreign keys, an operation check, and a composite primary key.

The migration stops if historical data shows a user in more than one list. It does not choose a list, rewrite ownership, or delete data. Startup refuses to serve the new application when the migration marker, revision, membership uniqueness, receipt table, or receipt constraints are missing.

## Rollback and operations

Application rollback is safe because the schema is additive and legacy endpoints remain intact. Leave migration 023 and its receipts in place during a routine rollback. Do not drop receipts while clients may retry outstanding mutations.

Receipts add one small row per accepted durable mutation. They are retained for now because the product's mutation volume is low and indefinite replay protection is safer than a premature cleanup policy. Add a measured retention job only after production volume and maximum offline duration establish a safe window.

Before the migration is applied in production, create and record a database restore point. Run the migration through the checked-in versioned migration runner, verify startup, then test snapshot, add, check, replay, and shared-list isolation with authenticated non-production data.

## Production rollout record

On 2026-08-22, before PR 30 could merge, Neon branch `pre-grocery-sync-2026-08-22` (`br-misty-resonance-a16c95sh`) was forked from `production` with data and schema. Auto-delete is disabled. Retain this branch until migration 023, API startup, and authenticated grocery smoke checks have all been verified in production.

# Recipes compatibility baseline

Inspected on 2026-10-10 against API/main commit
`37e64e2886506cc40d65d45657c630b43c0f97d4`. This slice adds regression evidence;
it changes no application behavior, database schema, deployment, or store record.

## Purpose and acceptance

Håfa Recipes turns cooking sources into a personal and shareable library, with
recipe chat, collections, meal plans, groceries, native link capture, and an iOS
grocery widget. Its installed clients must remain usable while Workouts is added
to the shared backend. Identity and every existing record's ownership must stay
stable. Whole-account deletion currently erases the Recipes account and queues
external identity/media cleanup; the approved future Håfa policy extends that
operation to both products.

Acceptance for this engineering slice is an offline, independently frozen
consumer harness plus targeted existing database integration tests. It is not
acceptance of the actual distributed mobile applications or the future shared
platform. Native journeys and exact release provenance remain release gates.

Sources: [product/system explanation](../PRODUCT-AND-SYSTEM.md),
[`mobile/lib/api.ts`](../../mobile/lib/api.ts),
[`mobile/types/recipe.ts`](../../mobile/types/recipe.ts),
[`api/app/routers/users.py`](../../api/app/routers/users.py), and repository
`AGENTS.md` at the inspected commit.

## Version evidence and remaining gaps

| Client | Verified here | What remains unverified |
|---|---|---|
| 2.6.4 source candidate | Commit `02c6204` declares version 2.6.4 and local iOS build 80. Its API client, recipe types, and native extension paths were inspected. The parent of `cc5fa6c`, `1f97911596dc49a28e7c38a909074789d705f6fd`, also declares 2.6.4, so a version string does not uniquely identify source. | Mapping to the public App Store binary, EAS build, Apple build, and any delivered OTA revision. |
| 2.6.11 current source | Commit `37e64e2` declares version 2.6.11 and local iOS build 88; its client defines the current contract snapshot. | Exact distributed build source, runtime fingerprint, update/channel history, and supported-device verification. |
| Older installed clients | Current API retains a no-body sharing path and legacy unowned-job claim behavior. | Complete supported-version inventory, older authentication issuers/binaries, devices unable to upgrade, and their actual contract/journey checks. |

There are no versioned 2.6.4 release tags in the inspected local Git history.
`mobile/eas.json` uses remote app versioning and production auto-increment. A
local `buildNumber` therefore does not establish the number of an EAS-built
artifact. Parent-reported TestFlight evidence is a lead for the release inventory,
not independently verified evidence in this document.

Do not claim "App Store compatibility passed" from source version strings or
these test counts. Before a shared-platform production release, record the exact
EAS/Apple build, source SHA, environment/issuer, runtime fingerprint and applied
updates, then execute the required flows using that artifact. Keep all existing
Recipes endpoints and the production address operational throughout store review.

## Frozen harness

The new [test module](../../api/tests/test_mobile_contract_compatibility.py) uses
synthetic fixtures only. It inspects the real application's OpenAPI registration
without entering its lifespan, so it starts no workers and connects to no database.
Standalone HTTP tests override authentication/database dependencies with narrow
fakes. Expected consumer shapes never import application schemas.

The [route manifest](../../api/tests/compatibility/mobile_routes.json) contains
117 frozen method/path pairs from the two inspected clients and native paths.
It covers Recipes, imports/jobs, identity/deletion/disclosure, groceries/widget,
native sharing, recipe/cooking chat, collections, meal plans, moderation controls,
pantry, and speech. Axios paths were extracted from those source revisions;
fetch, streaming, and native extension paths were added after inspection. Paths
retain trailing slashes; dynamic parameter names are normalized solely for
matching. Expected response codes and existing required query/header/body
conditions are frozen from the inspected backend baseline.

The harness detects:

- Removing or relocating a client endpoint, changing its HTTP method or success
  status, adding a required query/header argument, or making a previously
  body-free operation require a body.
- Losing required recipe/list/pagination keys or changing their JSON types.
  Legacy numeric ingredient quantities normalize to strings without mutating
  stored content; historical NULL audio state remains a boolean on the wire.
- Losing existing job states or replacing the recipe/job result linkage.
- Exposing the owner's stable/auth-provider identifiers, extraction text,
  operational moderation status, or extraction evidence in another viewer's
  recipe response.
- Requiring Workouts context in the inspected minimal Recipes capture/chat
  requests, changing private creation defaults, or rejecting native link imports
  that omit newer intent fields.
- Losing authenticated stable application identity, accepting anonymous job
  access, reassigning known job ownership, or breaking old no-body sharing.
- Breaking account deletion's HTTP 202/retry response or widget snapshot/checkoff
  shapes and privacy boundaries.

The [independent consumers](../../api/tests/compatibility/consumers.py) deliberately
ignore additive fields, as the JavaScript consumers do. They cover selected
required interface fields and important optional current fields; they are not a
full TypeScript implementation, a complete OpenAPI compatibility proof, or a
replacement for native testing. Three intentional mutated responses prove that
missing keys, changed primitive types, and new unrecognized job states fail.

The no-body sharing request predates the inspected 2.6.4 source, which already
sends an explicit target. Keeping its test preserves the API's documented older
client compatibility path, without claiming a specific binary uses it.

## Material implementation constraints

1. **Preserve stable ownership.** `/api/users/me/identity` returns the application
   ID, not the Clerk subject. Existing owner identifiers must not be rewritten
   while adding a shared account or a second app. Existing issuer-alias integration
   tests verify this against PostgreSQL.
2. **Retain deletion meaning.** `DELETE /api/users/me` returns 202 after local
   erasure, with durable cleanup intent. Its replay response remains stable. The
   current PostgreSQL tests verify actual local erasure, linked-record cleanup,
   tombstones, retry behavior, and external-target minimization. Future Workouts
   records and delayed jobs must join this lifecycle; these tests do not yet
   establish that future behavior.
3. **Keep scoped extension credentials.** Widget credentials allow bounded
   grocery snapshot/checkoff, not a general account session. Native sharing uses
   a different scoped credential. Neither should acquire access to Workouts or
   health records simply because the identity is shared.
4. **Keep source and intent separate.** Older native imports omit `is_public` and
   `location` and use credential defaults; newer imports snapshot capture intent.
   Preserve both until verified old extensions can be retired.
5. **Keep existing job vocabulary.** Both inspected clients understand queued,
   claimed, processing, completed, failed, cancelled, and expired. Add workout
   jobs behind their own interface rather than changing Recipes' status meanings.
6. **Keep compatibility additive.** New metadata such as nutrition provenance,
   household roles, or thumbnail-pending state is optional to older consumers.
   New shared-account requirements cannot become mandatory prerequisites for
   existing Recipes calls.

## Verification

The final focused run executed 220 tests, including 158 new compatibility cases
and existing public/sharing/identity/job/widget tests plus PostgreSQL widget,
identity, and deletion integrations. All passed. Ruff and `git diff --check`
passed for the changed files.

Integration tests require a dedicated disposable PostgreSQL database. Existing
fixtures reset their tables. They must not use production data or provider APIs.

Run the offline harness from the repository root:

```sh
PYTHONPATH=api uv run --project api pytest api/tests/test_mobile_contract_compatibility.py
```

Run the existing targeted integrations with an explicitly disposable
`TEST_DATABASE_URL`. Never point them at an application or production database.
Every integration PR must run the complete repository gate against its final
head. The harness does not replace mobile/web/admin gates, computer-use QA,
mixed-workload tests, App Store binary acceptance, or Workouts journeys.

## Maintaining the baseline

Do not regenerate these expectations from the modified server or delete a failing
consumer assertion to make a shared-platform change pass. Investigate failures
against the supported client artifact. When a supported client is added, inspect
its exact source/build evidence, add a separate consumer/fixture when behavior
differs, and execute it alongside existing clients. Retiring a baseline requires
a documented supported-version decision and actual replacement-client delivery.

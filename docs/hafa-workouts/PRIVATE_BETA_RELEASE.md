# Private beta release integration

This integration starts directly at production/main
`823986f48e4eb5de3075969a742f834036b5d473`. It combines the reviewed pre045 API
with the existing signed Workouts iPhone client, without merging experimental
branch ancestry or changing the Recipes mobile, web, admin or Render configuration.

## Frozen source

- API source: `253660117800ffd83494d91230beb199851ec427`, tree
  `de2fc100bc634cde5e51c3a3d6e7e0d3fefb9eb9` (335 files).
- Workouts native source: signed `eccf4b5e0fea658dead37fa04395c703ee265b92`, tree
  `a388a03ec3c15685e2d5103976e0f82c0f18fa0c` (208 files). This folder is byte
  identical to PR146 `02d255a49903b69788645ac52f8214b901c9f4a8`.
- CI and `scripts/check.sh` retain the existing Recipes gates and add only the
  reviewed native gate from PR146: tests, types, Doctor, runtime audit, exports
  and native bundle checks.
- API documentation comes from the API source. Android document saving, native
  health and dependency reachability documents preserve prior slice evidence
  from the signed source; their results are historical, not a new release gate.

Recipes core remains migration 033; optional Workouts migrations are 034–044.
Migration 045, server export jobs, diagnostic workflows and experiment sources
are absent. The signed client's successful capability discovery selects the
legacy 201 snapshot/page/save/delete flow when export jobs are absent; this still
requires verification against the deployed API. Discovery failure does not
select fallback. See [API provenance](../../api/docs/PRIVATE_BETA_API_SOURCE.md).

## Verification and deployment hold

The API `2855679` engineering gate passed 1838 API tests (35 skipped), 790 Recipes
mobile tests, Doctor 21/21 and 13 admin tests with required types/audits/builds.
API `2536601` changes only its provenance document after `2855679`. The signed
native source passed 412 JavaScript tests; its iOS 1.0.0(2) build was uploaded and
processed for TestFlight.
These component results do not establish this new combination's acceptance.
Its complete engineering/native gate, final review and affected device journeys
have not run yet. Android/device and full public acceptance remain separate.

Private-beta capacity acceptance requires a fresh matching isolated OFF baseline
and enabled candidate: absolute protected-read p95 ≤100 ms, relative p99 ≤2× that
baseline, memory peak ≤410 MiB, stop at 460 MiB, no OOM or protected errors, actual
persisted outcomes and compatible rollback proof. The approved 100 ms criterion
replaces the planned 1.25× relative p95 requirement only for this private beta.
It is neither an additional 100 ms delta nor an absolute p99 requirement. Prior
run 38164189237 remains failed under its original criteria. This does not close
the full 37-case public acceptance ledger or establish Render/Neon parity.

Production deployment remains on hold until capacity and recovery/rollback
evidence are accepted. Clerk's Workouts client/callback configuration and both
products' public native association were verified; actual signed-device login
still requires acceptance. The no-compute recovery branch was verified ready,
with its production parent/fork LSN and zero compute endpoints recorded. Actual
restoration has not been executed; ready metadata does not prove restoration.

Rollout uses the existing shared API URL and production identity. Keep public
access off and restrict Workouts to named stable AppUser IDs. Migrate in an
approved one-off process before enabling the serving master flag; retain a
persistent export/sharing encryption key. Paid AI stays off until the one shared
authority and combined $5 limit are verified. No schema, capability, credential
or production configuration is activated by this source integration.

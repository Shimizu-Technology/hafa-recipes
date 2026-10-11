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

The complete combined `./scripts/check.sh` passed on exact integration
`860a1082ec3e9618417d89f1bda15d02aafc968c`: 1838 API tests passed, 35 skipped and
16 existing warnings; 790 Recipes mobile and 13 admin tests passed. Both Expo
Doctors passed 21/21, with types, audits, web/admin builds, all-platform Workouts
exports and native bundle checks passing. Runtime audits reported zero unexpected
findings; web/admin production audits reported zero vulnerabilities.

The stock Workouts suite recorded 411 passed and one conditional skip. A separate
native-only follow-up supplied this exact checkout and its own Python interpreter
through the two explicit backend bindings, then passed all 412 with zero skips,
including the real native-store/API-validator continuity contract. The stock
receipt remains unchanged; the follow-up is separate evidence, not an API rerun.
Final receipt SHA256:
`bd9d7f18cc90649c9e1733ccd72a7ef86937ef55cdf97f69cdc5f73f8df2f906`.
Owned gate processes, PostgreSQL container and disk bind were closed/released;
ordinary cleanup passed and no active owned resources remained.

An independent nonauthor review of exact `860a108` completed without material
findings. CodeRabbit's automatic attempt explicitly skipped 337 reviewable files
against its configured 100-file limit; this is neither a completed bot review nor
approval. No duplicate request or paid upgrade was made. All five CI jobs passed
on `860a108`. A later documentation-only head retains the frozen API/native trees;
the executed gate source is `860a108`, not a claim that the later whole Git head
was tested. The signed iOS 1.0.0(2) build was uploaded and processed for TestFlight;
actual device, configuration, capacity and rollback acceptance remain pending.
Android/device and full public acceptance remain separate.

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

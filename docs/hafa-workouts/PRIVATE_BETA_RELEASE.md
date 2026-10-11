# Private beta release integration

This integration starts directly at production/main
`823986f48e4eb5de3075969a742f834036b5d473`. It combines the reviewed pre045 API
with the Workouts iPhone client and its reviewed account-recovery correction, without merging experimental
branch ancestry or changing the Recipes mobile, web, admin or Render configuration.

## Frozen source

- API source: `253660117800ffd83494d91230beb199851ec427`, tree
  `de2fc100bc634cde5e51c3a3d6e7e0d3fefb9eb9` (335 files).
- Workouts native source: `325cde603a2246d2e36bb9bc58bc184ba9e2656b`, tree
  `a132a86eeaee7afa8485f42577b5d34c945c0acb`. PR157 merged this correction
  into integration `b8cb96418732c69be0e9d7c189140579aa2f228b`. Compared with
  signed build2 source `eccf4b5e0fea658dead37fa04395c703ee265b92`, only the
  training provider and its tests changed. Native modules, signing configuration,
  dependencies and production build settings remain identical.
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
on `860a108`. The full combined gate remains pinned to that source; later
native acceptance is recorded separately below. The signed iOS1.0.0(2) build
was uploaded and processed for TestFlight. Updated build3 is in progress from
`b8cb964`; processing and tester availability must be verified after submission.
Physical device, production sign-in, capacity and rollback acceptance remain
pending. Android/device and full public acceptance remain separate.

PR157 provides a clear401/403 message and captured-session sign-out when private
training is blocked. It preserves owner drafts and clears only that account's
query cache. CodeRabbit found that a failed identity refetch could retain earlier
successful data; deny-first owner selection now closes private consumers even
when TanStack retains that data. Both401/403 regressions and the affected native
gate passed:419 tests, types, Doctor21/21, audit with zero unexpected findings,
three-platform exports and native bundle checks. Root independently reviewed the
final correction. CodeRabbit explicitly confirmed the fix and resolved its Major
thread; its final incremental review was rate limited, not approved. All five
CI jobs passed on `325cde6` before the child PR merged into this release branch.

Agent-executed iPhone18.5 QA used a compatible development shell, development
Clerk and isolated local data. Account denial/sign-out/relogin preserved the
profile and exactly one synced session. A manual workout retained unknown
prescribed reps and Bodyweight equipment; its two actual sets contained8 and7
reps. The legacy private JSON export opened the share sheet; cancellation removed
the temporary file and server snapshot/pages. Final native source was reloaded
and account recovery repeated with an already enrolled account. All owned local
UI resources were physically cleaned. These checks do not establish physical
TestFlight or production SSO acceptance.

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

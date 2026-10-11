# Private export totals equality

HafaWorkouts exports one fixed snapshot of a user's server records. The native
client must reject changes in identity, permissions, generation, counts or paging
while allowing different JSON object key orderings.

On 2026-10-11, root's iOS QA at native `7139ccf` reached a ready private export
but failed before the save sheet with “The private snapshot changed.” Root's
content-free database proof found all 23 totals keys and values equal, with
different key orderings; snapshot identity, generation and page metadata matched.
This is a reported root observation, not a child-executed device check. The private
proof is retained in root's `export-key-order-proof.json`; no private rows are
copied here.

The async job manifest is stored as PostgreSQL JSONB, while encrypted pages retain
their original JSON serialization. Native string comparisons treated the resulting
key ordering difference as a data change. The shared comparator now compares exact
keys and safe nonnegative integer values regardless of order. Missing or extra
keys, invalid counts and changed values still fail. Existing owner/generation,
profile revision, permissions, page sequence, completeness and byte bounds remain.

Focused regression fixtures contain the frozen 23-key API schema with three
synthetic workouts, three versions and two original/corrected historical session
events. They also cover reordered multipage totals and rejection of count,
identity, generation, revision, permission, consent, paging and record changes.
Final manifest validation uses the same comparison.

The focused export suites passed 109 tests across six files; all Workouts tests
passed 412 tests across 43 files, including the real backend schema/continuity
bridge, and TypeScript checking passed. The first full-suite attempt had 411 passes
and one environment failure: the private wrapper supplied `WORKOUTS_BACKEND_ROOT`
as the API folder instead of the repository root. Correcting only that wrapper
resolved it; both original and successful logs are retained privately.

Root reviewed the prepared source and tests without material findings. Required
iOS save-flow retest, Android acceptance, canonical gates, final integration review
and PR publication remain root-owned; this patch does not claim release readiness.
Finite owned processes completed and were released; no QA servers or devices were
started.

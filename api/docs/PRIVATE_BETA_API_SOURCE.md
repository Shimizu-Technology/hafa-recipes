# Private iPhone beta API source

This assembly preserves the existing shared Recipes service and supplies the
pre045 Workouts API used by the signed ECCF iPhone client. Public access remains
disabled. It adds no new business logic or deployment configuration.

Source provenance:

- Base: PR133 `990cc56be64b510f50c589a70bddb79a749ac50a`.
- API copied exactly from `e93ecde656029c48fa269f2eb867b9a693433300`.
  This combines complete capture, library, profile, coach, plans, sessions,
  activity, connections and synchronous private exports through migration044.
- Budget authority files match PR139
  `20ba123117e64003749e9c9751ce397cb6b1ce64`; JPEG processing files match PR137
  `7a46276caf393b2b632a5781ca46522d50d061f4`.
- The only additional runtime change is the reviewed twelve FFmpeg arguments
  from `8d4b175fc43a5e2d561b0e4c158718ac9c20500f`: one decoder thread before
  input, one filter thread and one output encoder thread in both frame writers.
  The regression test is copied from that exact source. Existing private logging,
  deadlines, scene/PTS logic, frame limits and media permits remain intact.

Recipes core migrations remain through033. Optional Workouts migrations end at
044; migration045 and durable export jobs are absent. The existing ECCF native
client selects the legacy201 snapshot/page/save/delete flow after successful
capability discovery without `export_jobs`. Its regression is
`workouts-mobile/lib/export-job-screen.test.ts`, “retains old201 export behavior
only after a known absent capability”; failed discovery never selects fallback.

This source is prepared for review, not verified for deployment. Earlier failed
capacity measurements, the incomplete native queue proof and the full37-case
public acceptance ledger remain open. The new combined tree needs its complete
engineering gate, affected native legacy-export checks and required capacity
verification. Production backup/restore references, compatible rollback,
installed Recipes smoke, named tester configuration, the shared $5 authority,
Clerk registration and bounded real-provider journeys remain rollout steps.
No migration, activation, provider call or production write occurred here.

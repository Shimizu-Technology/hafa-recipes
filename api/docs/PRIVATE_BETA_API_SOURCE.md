# Private iPhone beta API source

This assembly preserves the existing shared Recipes service and supplies the
pre045 Workouts API intended to remain compatible with the signed ECCF iPhone
client. This combined source has not yet been verified against that installed
client. Public access remains disabled; no deployment configuration changes here.

Source provenance:

- Base: PR133 `990cc56be64b510f50c589a70bddb79a749ac50a`.
- Initial API assembly copied from `e93ecde656029c48fa269f2eb867b9a693433300`.
  This combines complete capture, library, profile, coach, plans, sessions,
  activity, connections and synchronous private exports through migration044.
- `budget_authority.py` and `budget_router.py` retain exact PR139 bytes from
  `20ba123117e64003749e9c9751ce397cb6b1ce64`. `budget.py` retains that authority,
  indefinite-hold and $5 policy behavior but corrects its conservative input
  bound to the documented 1,050,000-token context instead of the derived 922,000
  assumption. Budget docs now preserve PR139's authority and hardening record,
  with current bounds and historical test results clearly distinguished.
  JPEG processing files match PR137
  `7a46276caf393b2b632a5781ca46522d50d061f4`.
- The first additional runtime change is the reviewed twelve FFmpeg arguments
  from `8d4b175fc43a5e2d561b0e4c158718ac9c20500f`: one decoder thread before
  input, one filter thread and one output encoder thread in both frame writers.
  The regression test is copied from that exact source. Existing private logging,
  deadlines, scene/PTS logic, frame limits and media permits remain intact.
- The second is the conservative budget bound above: Luna extraction/coaching
  reserve 535800/528240 microUSD; Terra extraction's 5358000 bound exceeds the
  unchanged 5m ceiling and is denied before admission/transport. No model, rate,
  authority, retry or refund behavior is changed. Focused regressions are prepared
  for selected Terra denial and retained failed-Luna cost on denied fallback.

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

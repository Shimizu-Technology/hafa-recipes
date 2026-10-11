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
- The budget authority and router originate in PR139
  `20ba123117e64003749e9c9751ce397cb6b1ce64`; `budget_router.py` retains those
  exact bytes. The authority runtime includes the configuration hardening below.
  `budget.py` retains PR139's authority,
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
  authority, retry or refund behavior is changed. The Terra denial and retained
  failed-Luna cost regressions passed in the complete engineering gate below.
- The five-file follow-up `285567961c9a15d42db31fa391585ca4f2a15b09`
  restricts local plaintext authority connections to development/test and keys
  cached engines by the actual TLS decision. Empty or whitespace authority
  configuration becomes absent; operational AI capabilities remain off and the
  guard retains its unconfigured error. Config, budget guard, authority runtime
  and their two test files changed; the $5 admission and durable-hold policy did
  not change.

Recipes core migrations remain through033. Optional Workouts migrations end at
044; migration045 and durable export jobs are absent. The existing ECCF native
client selects the legacy201 snapshot/page/save/delete flow after successful
capability discovery without `export_jobs`. Its regression is
`workouts-mobile/lib/export-job-screen.test.ts`, “retains old201 export behavior
only after a known absent capability”; failed discovery never selects fallback.

The complete `scripts/check.sh` gate passed at
`285567961c9a15d42db31fa391585ca4f2a15b09`: 1,838 API tests passed with 35 stock
skips, 790 Recipes mobile tests and 13 admin tests passed, and Ruff, types,
Doctor 21/21, runtime audit, lint and builds passed. All 25 configuration-hardening
cases passed in both the 164-test focused gate and the full gate. The stock real
FFmpeg test passed against local 7.1.1. This is macOS ARM64/CPython 3.12.8 with an
own frozen uv environment, exact-lock Node 22.22.2 dependencies and disposable
Postgres 15.19 fixtures; it does not establish Render runtime parity.

Deployment and installed-client acceptance remain unverified. Earlier failed
capacity measurements, the incomplete native queue proof and the full 37-case
public acceptance ledger remain open. Affected native legacy-export checks and
required capacity verification remain release steps. Production backup/restore
references, compatible rollback,
installed Recipes smoke, named tester configuration, the shared $5 authority,
Clerk registration and bounded real-provider journeys remain rollout steps.
No migration, activation, provider call or production write occurred here.

# Durable Workouts AI admission budget

The original ledger slice started at `4e1065b`. Provider integration followed;
the October 11 hardening adds explicit authority configuration, conservative
carryover and shutdown cleanup. Recipes paid-provider controls remain unchanged.

The shared-authority guard reserves a conservative amount before
one Workouts provider attempt. All workers sharing the database serialize
admission with PostgreSQL transaction advisory lock 7340040. The independent
reservation transaction explicitly uses READ COMMITTED, including with an
injected REPEATABLE READ factory: a waiting snapshot must observe the previous
lock holder's committed reservation. Database time, not a process/device clock,
defines the window. The row commits before any provider body can execute.

A validated success retains the full reservation for 24 hours after the later of
admission and its durable finish. Every nonsuccess outcome (unknown, failed,
cancelled), missing finish acknowledgement, worker crash and outcome-write failure
remains charged indefinitely. A local timeout or cancellation does not prove that
the provider stopped billing. There is no optimistic refund. Each
fallback, retry or paid tool round needs a new attempt. Per-attempt upper bound is
model/envelope specific; it must fit both the configured attempt cap and remaining
shared admission capacity. Daily and per-attempt limits cannot exceed the
authorized combined 5,000,000 microUSD ceiling. All workers must use the same
verified configuration;
a deployment changing limits must pause/drain old workers before activation.

## Verified pricing/envelopes

Official documentation checked 2026-10-10 establishes both exact snapshots
[gpt-5.6-luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) and
[gpt-5.6-terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) have
922,000 max input, 1,050,000 context, and 128,000 max output tokens. The
[vision guide](https://developers.openai.com/api/docs/guides/images-vision) says
billable image tokens and the rest of the prompt fit input/context limits. The
guard uses that full documented input ceiling rather than a text-length estimate
or guessed image formula. Function schemas also fit that token bound.

[Standard pricing](https://developers.openai.com/api/docs/pricing) includes 2x
input/1.5x output for input above 272K, and 1.25x input for cache writes. Worst-case
input pricing takes cache writes. Current conservative amounts are:

| Exact model/envelope | Admitted microusd | USD equivalent |
| --- | ---: | ---: |
| Luna extraction, output cap 6000, text or image |471800|0.4718|
| Luna coaching, output cap 1800 |464240|0.46424|
| Terra extraction, output cap 6000 |4718000|4.718|
| Whisper, independently probed 61 seconds |12000|0.012|

Token rates must also be explicitly present, finite and positive in existing
`ai_model_pricing`. Verified reference floors prevent stale low quotes lowering
admission; higher configured rates increase it. Discounts are not assumed.
Whisper's verified 0.006 USD/min uses conservative whole-minute rounding, only for
server-probed, validated audio duration up to 1800 seconds. No duration proof means
no audio admission. Unknown models or unavailable pricing fail closed.
Whisper is [scheduled for retirement 2027-02-26](https://developers.openai.com/api/docs/deprecations#2026-08-26-transcription-models); a new
transcription model needs independently verified registry/pricing support.

Supported envelopes select the exact provider endpoint and explicit output cap.
Custom local function tools are supported for coaching. Paid hosted/built-in
tools, alternate tiers, regional processing and automatic SDK retries are
unsupported. Root must send actual `service_tier:"default"` and use verified
global processing; merely declaring an envelope while sending different provider
parameters is not enforcement. The key/project processing settings and model
availability must be verified before enabling paid work.

**This admission accounting is not a guaranteed provider bill ceiling.** Provider
pricing, usage reporting, processing configuration and calls outside these
Workouts paths can affect invoices. Recipe calls are deliberately outside this
guard. Observed-usage cost estimates are displayed separately and do not release
admission capacity. The provider's billing records remain the invoice authority.

## Root integration contract

Add settings `workouts_ai_budget_24h_microusd:int=0` and
`workouts_ai_max_attempt_microusd:int=5000000`. Zero daily budget is unconfigured:
no live Workouts provider can run, and admission performs no database connection.
Disabled master API likewise performs no connection. This must not invalidate
Recipes startup or change its paid-provider controls.

After AIInvocationTracker selects the actual model, admit only capabilities in
`budget.CAPABILITIES`: workout_extraction, workout_coach, workout_transcription.
Legacy recipe extraction/chat/transcription and other capabilities do not invoke
the guard. Add an optional server-derived Workouts envelope to tracker creation;
missing envelopes fail closed for these Workouts capabilities.

```python
from app.domains.workouts.budget import BudgetGuard, BudgetPolicy, ProviderEnvelope

reservation = BudgetGuard(BudgetPolicy.from_settings(settings)).attempt(
    capability=invocation.capability,
    model=invocation.model,
    envelope=ProviderEnvelope(
        endpoint="chat_completions",  # responses for coach; audio_transcriptions for audio
        max_output_tokens=6000,       #1800 for current coach; None for audio
        includes_images=True,        # exact actual provider shape
        sdk_max_retries=0,
    ),
)
await reservation.__aenter__()  # Independent committed transaction before paid call.
# ... perform exactly one validated provider attempt with the enforced envelope ...
reservation.complete(outcome="success", estimated_cost_microusd=usage_estimate_or_none)
await reservation.__aexit__(exc_type, exc, traceback)  # In tracker finally.
```

The same API can be used with `async with guard.attempt(...) as reservation`.
Guard/factory are reusable; each attempt object is single use. Dependency injection
accepts `session_factory=...` for tests. Audio envelopes require
`audio_seconds_upper_bound` and `audio_duration_verified=True`, with no output or
image/tool fields. Do not copy caller-declared duration into that proof.

Map tracker outcomes to success/failed/cancelled/unknown. Any exception overrides
success to failure/cancellation. Unknown usage stays null. Outcome persistence is
best effort: failure retains the already committed unknown reservation and does
not suppress the caller's original error. Estimated costs may exceed admission;
that remains visible rather than being silently clipped. Never persist this
random budget attempt UUID on an owner/job/request record or expose it to users.

BudgetError provides a closed privacy-safe `code`, `status_code` and optional
`retry_after_seconds`. Exceeded rolling capacity yields 429 with the first confirmed-success expiry
that frees sufficient capacity; unresolved rows have no automatic expiry. If
confirmed releases cannot free enough capacity, retry_after is null; configuration, unsupported envelope/model,
attempt cap or database failures yield 503. If the single bound exceeds the daily
budget, waiting cannot fix configuration and retry_after is null. Root adapters
must propagate these bounded failures before provider/fallback invocation; do not
turn a rejected admission into another paid retry. User messaging can say AI is
paused without showing source content or operator budget details.

Register `budget_router.router`: GET `/api/admin/workouts/ai-budget?limit=50`.
It uses the actual existing `app.moderation.require_admin`; no invented admin gate
or enrollment is introduced. Master disabled returns 404 before auth/database.
It exposes aggregate admission, remaining capacity, outcomes/model groups, known
usage estimates, unknown counts and failure codes; no private content/identities.
Groups have a 1–50 limit. These are live diagnostics, not invoice reconciliation.

Run optional migration 040 after 035 with verified production
`MIGRATION_040_RESTORE_POINT`, separate from Recipes ledger/latest 33. Invoke
`verify_budget_schema(engine, settings)` in enabled optional readiness. It checks
ledger 40, the exact allowed columns, absence of account foreign keys, and enabled
reservation immutability trigger. Do not add this table to user erasure/export or
new worker startup. Its independent BudgetBase contains no account table.

## Privacy and verification

Rows contain only random attempt UUID, closed capability/model, admitted amount,
optional estimated cost, closed outcome, admission and finish times. No account,
source, health, prompt, text, body, job or request IDs are stored. Account or
product deletion cannot reset global capacity. Reservation identity/model/amount/
time are immutable; final outcome can be recorded once.

Thirty focused tests cover verified text/vision/tool/audio bounds, unpriced or
unsupported rejection, disabled/unconfigured database-free behavior, independent
concurrent sessions, REPEATABLE READ safety, durable pre-body commit, rolling
expiry and sufficient-capacity retry, unknown/failure/cancellation consumption,
outcome DB failure, account deletion independence, actual admin authorization,
bounded diagnostics, closed codes, immutability and migration/restore/readiness.
No paid call, new provider, production data, server, browser, simulator or owned
container is used. Exact committed combined test results and test database
cleanup accompany delivery. Root provider integration/enforcement and actual
release acceptance remain required before paid activation.

## Explicit authority and safe activation (October 11 hardening)

`WORKOUTS_AI_BUDGET_DATABASE_URL` is a SecretStr used only for the anonymous
ledger. It never defaults to the application database. A positive budget without
this binding denies admission before provider dispatch. Zero/default-off does
not create an authority connection. Admin budget diagnostics read this same
authority, never the application's separate ledger. A tiny lazy pool has one
connection, no overflow, bounded connection/pool/statement waits, hidden SQL
parameters, a pinned `public` search path and verified TLS for remote endpoints.
Client settings cannot supply SQL/search-path options. Each default admission and
diagnostic read independently verifies authority migration 040, the exact
anonymous columns, absence of foreign keys and the enabled immutability trigger.
A valid application schema cannot substitute for this authority check.
Application shutdown disposes
the pool. Explicit constructor session-factory injection is for trusted synthetic
tests only; it is not a deployment bypass.

Initial policy: ONE durable authority/ledger is shared across testing and beta.
Both environments may send paid requests only after an operator verifies that
each binding resolves to the SAME existing endpoint, database and
public.workouts_ai_admissions table. Unverified environments and independent
ledgers keep budget zero and paid capabilities off. Every configured caller is
capped at $5 and atomically compares its reservation against the shared total.
Source code
cannot discover different deployments' URLs and cannot prove that inventory.
Do not use a disposable fixture database as a paid authority or reset/delete
admission rows. Never configure independent $5 ledgers. Static allocations summing
to $5 are insufficient during same-day transfers. Preserve the ledger across
restart/redeploy. Transfer or replacement remains blocked until dispatched work
is verified drained and a full 24-hour carryover after the latest verified completion
has elapsed; unresolved requests remain charged and block unsafe transfer.

An additional role on the existing operator-selected Neon database can provide
local development a budget-only credential: schema USAGE and SELECT/INSERT/UPDATE
on the anonymous ledger, with NO DELETE/TRUNCATE/DDL, table ownership, inheritance
from customer-data roles or customer-table privileges. Existing installation of
migration 040 and its immutability trigger belongs to the authority owner, not
this credential. The reader also requires SELECT on the `version` column of
`workouts_schema_migrations` plus ordinary PostgreSQL catalog visibility for its
read-only verification; customer tables and other migration columns are excluded. No endpoint, key, role, production grants or DDL is
provisioned by this slice. No production URL is invented.

Success is the only currently supported proof of completed dispatch; failures and
cancellations remain permanently charged. There is no automated reconciliation
or privileged release endpoint. Reclaiming unresolved cost would require a
separately reviewed proof-based reconciliation design that preserves receipt
immutability; deleting receipts is not an acceptable reset. Provider billing
reconciliation and current price/model/project processing verification remain
activation gates. These reservations still do not guarantee invoices: Recipes
and calls outside these adapters are excluded. Any Workouts evaluation harness
must use the same guarded adapters/authority rather than a standalone SDK call.

Hardening verification: the affected PostgreSQL/provider/automation gate passed
112 tests. It covers old unfinished/failed/cancelled holds, late successful
completion, insufficient confirmed releases, restart/concurrent workers, zero
HTTP calls without authority, six malformed separate-authority schemas despite a
valid application schema, and a role-default shadow schema that cannot redirect
public admission or diagnostics. The complete canonical gate passed 1,757 API
tests (35 skipped, 16 existing warnings), 790 Recipes mobile tests, Doctor 21/21,
13 admin tests, types and web/admin builds. Runtime audits reported zero
unexpected advisories; web/admin production audits reported zero vulnerabilities.
All transports were synthetic. No real provider call, credential/grant change,
production migration, device journey or invoice reconciliation was executed.

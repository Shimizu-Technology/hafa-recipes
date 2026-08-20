# AI Model Governance and Rollout Runbook

Status: active
Owner: Håfa Recipes product/engineering operator
Applies to: extraction, OCR, chat, enrichment, transcription, and speech

## Policy

Model names are replaceable infrastructure, not product copy. A model change
must have a comparative Håfa-specific report before it receives production
traffic. Routine traffic stays on the lowest-cost model that passes the quality
bar; higher-cost models are used only where measured quality justifies them.

The current recipe/OCR policy is Luna first, with Terra reserved for a
deterministic failed/invalid result. Unknown models have unknown cost in
telemetry until an operator explicitly configures pricing.

## Privacy boundary

`ai_invocations` may contain only:

- request ID and internal user/job foreign keys;
- capability, provider, model, prompt/schema version, and rollout variant;
- fallback reason, stable status/error code, and provider request ID;
- latency, token counts, and configured cost estimate; and
- creation time.

It must never contain prompts, completions, recipe text, transcript text, chat
content, images, full source URLs, notes, email addresses, Clerk tokens, or
provider error bodies. Account deletion cascades the user's invocation rows.
Structured AI logs use only the opaque public contributor identifier.

## Evaluation gate

The canonical dataset is
`api/evals/golden/recipe_extraction_v1.json`. It is synthetic and covers:

- video transcript extraction;
- website text extraction;
- single-image OCR;
- multi-page OCR; and
- a low-quality source where invented measurements are penalized.

Validate it without paid calls:

```bash
cd api
.venv/bin/python -m evals.run_recipe_model_eval --dry-run
```

Run a comparison with a local, budget-limited provider key:

```bash
.venv/bin/python -m evals.run_recipe_model_eval \
  --env-file /absolute/path/to/local-eval.env \
  --models gpt-5.6-luna gpt-5.6-terra
```

Reports contain per-case metrics and aggregate results, but never provider
outputs. Review task success, schema validity, completeness, corrections,
hallucinations, median latency, reasoning/output tokens, total estimated cost,
and cost per successful task. A report is evidence for a rollout decision; it
does not automatically modify production configuration.

The initial comparison is stored at
`api/evals/reports/luna-terra-recipe-extraction-2026-08-19.json`. At reasoning
effort `none`, Luna passed 5/5 cases with no scored corrections or
hallucinations for an estimated $0.006572 total. Terra passed 4/5, invented
measurements in the deliberately incomplete case, and cost an estimated
$0.067489 total. This small synthetic benchmark supports Luna as the routine
baseline and does not support paying for Terra universally. Terra remains a
bounded fallback because the benchmark is a regression gate, not proof that
every difficult real-world input is better served by either model.

The separate synthetic chat benchmark covers doneness, serious allergies,
spoilage, pregnancy, uncertain measurements, and recipe scaling. Validate it
without provider calls:

```bash
cd api
.venv/bin/python -m evals.run_chat_model_eval --dry-run
```

Run the focused Luna/Terra chat comparison only from an approved environment
with a current evaluation credential:

```bash
.venv/bin/python -m evals.run_chat_model_eval \
  --env-file /absolute/path/to/local-eval.env \
  --models gpt-5.6-luna gpt-5.6-terra
```

Chat reports retain only deterministic scores, token/cost counts, latency,
response length, and provider error class. Prompts and responses are never
written to the report. An authentication error is an invalid run, not a
zero-quality model result; any provider failure aborts the comparison before a
report can be written. Unsafe-claim checks use affirmative regular expressions
with clause-local negation checks, so safety statements such as “cannot
guarantee it will be safe” are not scored as unsafe while an affirmative claim
after punctuation or a contrast conjunction still fails. Safety-critical
required concepts use narrow directional patterns where a bare word or generic
negation could invert meaning; merely mentioning visual appearance—or saying it
is “not the only thing” to check—does not satisfy the doneness-uncertainty
requirement.

## Canary rollout

Canaries are configured independently by capability:

```text
AI_CANARY_MODELS={"recipe_extraction":"candidate-model"}
AI_CANARY_PERCENTAGES={"recipe_extraction":5}
```

The bucket is deterministic from the durable job ID or request ID, so retries
do not jump between models. Start at a bounded percentage, compare the admin
24-hour usage summary and model-specific database metrics, then increase only
when success/fallback/cost remain within the approved report's bounds.

Do not use a canary percentage to implement Terra fallback. Extraction and OCR
fallback are separate deterministic attempts and record the primary failure as
their `fallback_reason`.

## Immediate rollback

1. Set the affected capability percentage to `0` in Render.
2. Deploy the configuration change.
3. Confirm new `ai_invocations` rows use `rollout_variant=primary`.
4. If the primary itself is unhealthy, use `AI_DISABLED_CAPABILITIES` to turn
   off only the affected capability while preserving the rest of the app.
5. Record the incident and do not resume the candidate until a new comparative
   report passes.

No database rollback is needed. Migration 021 is additive and older
application code ignores the provenance table.

## Operational queries

The authenticated admin diagnostic response contains 24-hour attempts,
successful outcomes, repaired outcomes, failures, fallbacks, unknown-cost
attempts, and estimated cost in micro-US dollars. For a model comparison,
query only aggregate provenance columns; do not join recipe content into an
operational report.

Alert thresholds should be implemented in the admin/analytics slice for:

- success or schema-valid rate falling below the approved baseline;
- fallback rate materially exceeding the benchmark;
- p95 latency regression;
- unknown model pricing; and
- daily estimated cost exceeding the operator's budget.

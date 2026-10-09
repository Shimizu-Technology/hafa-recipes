# Recipe cover provider evaluation — October 9, 2026

All eight planned provider cases passed with eight actual grading calls. This is a small acceptance check of the provider boundary, not a ranking-quality benchmark or a complete native import journey.

Håfa Recipes helps recipe collectors recognize and retrieve saved dishes as part of capture → save → organize → plan → shop → cook. This evaluation checks whether cover grading chooses the correct finished dish, replaces a visibly inferior cover, preserves a good incumbent, and declines unsuitable candidates. Context: [product overview](PRODUCT-AND-SYSTEM.md), the cover selector, and Leon's recorded household-recipe origin in Brain Dump's `work/shimizu-tech/company-positioning-and-project-review-2026-10-04.md`.

## Tested version and environment

- Execution owner: agent, under Leon's implementation/testing/release authorization.
- Scope: C9 provider boundary; affected-flow acceptance. Native UI, persistence, extraction, jobs, and release availability remain separate checks in the main QA ledger.
- Integration baseline: `93c416f`. Selector fix: `da291bbf700dfd950f35d516e122f9bbf518d17a` (cherry-picked by the main task as `112d929`).
- Exact tested selector SHA-256: `399061d9dc4d03c1f6587e538cefe34cc133d2ab93240efb9afd5d71edd731db`.
- Runtime: existing Render Python environment, Pillow 12.3.0, configured `gpt-5.6-luna`, `recipe-cover-v1`, no model override or fallback retry.
- Isolation: exact selector source and public fixture bytes executed through SSH stdin in an ephemeral Python module. The existing provider credential stayed in the runtime. Invocation recording was redirected to memory for safe usage metrics; no production database records, recipes, S3 objects, persistent files, services, or configuration were changed.
- Real components: candidate normalization, perceptual filtering, hero/card crops, HTTP transport, model response, schema/grade validation, abstention and incumbent comparison.
- Input acquisition: licensed still photos downloaded locally. Video acquisition was not exercised here. Fixtures were visually inspected before expectations were set.

## Acceptance results

Candidate IDs identify fixture positions, not source users. Each case required its independently defined expected candidate or abstention, with no provider/validation error.

| Case | Expected and observed outcome | Status | Candidates after filtering | Provider latency | Input/output tokens | Estimated cost |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| E01 | Choose pizza `c2` over burger | passed | 2 | 4.094 s | 1,251 / 99 | $0.000369 |
| E02 | Choose burger `c2` over pizza with YouTube crop | passed | 2 | 3.477 s | 1,129 / 99 | $0.000345 |
| E03 | Replace blurred pizza incumbent with clear same-scene `c2` | passed | 2 | 2.781 s | 1,246 / 99 | $0.000368 |
| E04 | Retain good pizza incumbent `c1` against wrong dish and blurred duplicate | passed | 2 | 1.995 s | 1,246 / 99 | $0.000368 |
| E05 | Abstain: both food photos are unrelated to tomato soup | passed | 2 | 2.879 s | 1,241 / 98 | $0.000366 |
| E06 | Abstain: recipe text and adversarial instruction cards show no food | passed | 2 | 2.007 s | 1,245 / 98 | $0.000367 |
| E07 | Retain burger incumbent `c1`; discard identical duplicate | passed | 1 | 2.482 s | 824 / 61 | $0.000238 |
| E08 | Choose sharper pizza slideshow `c2` over blurred same scene | passed | 2 | 2.398 s | 1,246 / 99 | $0.000368 |

Totals: 8 passed, 0 failed, 0 blocked, 0 not run within this named provider plan. Eight calls stayed below the ten-call cap. Usage was 9,428 input tokens and 752 output tokens; cached and reasoning tokens were zero. Median provider latency was 2.632 seconds; range 1.995–4.094 seconds. Selector wall time ranged from 2.111 to 4.269 seconds, excluding SSH startup. Summed per-call estimated cost was $0.002789, using the runtime registry rates of $0.20/million input and $1.20/million output tokens. These are configured estimates, not a reconciled provider invoice.

## Defect found and retested

Fixture preflight exposed a material deduplication defect: a clear pizza frame and its blurred incumbent had nearly identical perceptual hashes and mean colors, so the clear frame was removed before grading. The fix keeps materially sharper challengers while still removing equal or inferior duplicates and bounding the shortlist to eight. A synthetic regression explicitly establishes matching perceptual hash/color before asserting that both candidates survive; reversing the quality preserves the sharp incumbent and removes the blurred challenger. E03 and E08 then passed against the real model.

Automated verification: 43 selector tests plus 7 evaluation-tool tests passed. Ruff and whitespace checks passed. These tests cover mechanics and safe execution boundaries separately from the eight actual model calls.

## Public fixtures and reproduction

The metadata manifest stores source pages, authors, licenses, download URLs, and content hashes. No image binaries are committed.

- [New York pizza](https://wordpress.org/photos/photo/752620fc4a/) by Topher; CC0 1.0. The inspected image shows pepperoni/sausage pizza on a metal tray.
- [Burger photo](https://wordpress.org/photos/photo/71469d9234/) by Mohammed Kateregga; CC0 1.0. The inspected image shows a sesame bun burger with cheese, vegetables, and fries.
- Text cards are agent-authored QA fixtures generated by the runner. Blur variants apply a deterministic 14-pixel Gaussian blur to the licensed pizza photo. They are controlled defects, not unmodified source captures.

From the API directory, `python evals/run_cover_selection_eval.py --fixture-dir /tmp/cover-public` acquires/verifies public images and performs preflight with zero provider calls. Actual calls additionally require explicit `--execute-remote --remote-host user@host`; `--cases E01 E02` selects a bounded batch. Each run permits at most ten named cases, performs one model attempt per case, and emits only sanitized operational/result metadata. The recorded run used four batches of two cases with no retries.

The primary sources are in [cover_selection_public_v1.json](../api/evals/fixtures/cover_selection_public_v1.json). Wikimedia acquisition was attempted first but originals were rate-limited; no Wikimedia image was used in the acceptance results.

## Remaining coverage and disposition

Two licensed food photos and authored negative cards cannot establish broad ranking quality. Guam dishes, actual social-video scene sampling, multiple similar dishes, non-English overlays, portrait compositions, calibrated preference rates, production load, and worst-case latency were not run in this provider plan. Native import/display/manual-photo preservation and saved-job behavior require the parent task's actual UI and persistence acceptance. A larger permissioned-video evaluation remains useful after this bounded release check.

No long-lived runtime resources were started. Public fixtures under `/tmp/hafa-cover-eval-public` were handed to the main task for its native QA and may be removed after that phase. No remote artifacts remain.

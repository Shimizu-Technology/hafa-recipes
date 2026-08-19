# ADR-004: Evaluate GPT-5.6 Luna as Baseline with Terra Escalation

Status: accepted, rollout evaluation required
Decision date: 2026-08-18
Decision owner: product owner

## Context

Active code contains retired Gemini 2.0 and deprecated GPT-4o model IDs. The replacement choice affects extraction accuracy, chat quality, latency, and recurring cost.

OpenAI describes GPT-5.6 Terra as the equivalent of the earlier mini tier and GPT-5.6 Luna as the equivalent of the earlier nano tier. Both support text and image input, structured outputs, Chat Completions, and the Responses API. At standard short-context rates on the decision date, Terra costs $2.00 input/$12.00 output per million tokens while Luna costs $0.20 input/$1.20 output.

## Decision

Do not make Terra the universal default. Evaluate:

- GPT-5.6 Luna with `reasoning.effort: none` and `low` as the routine OpenAI baseline;
- GPT-5.6 Terra at comparable settings as an escalation for inputs that fail deterministic schema, completeness, or confidence gates;
- current Gemini Flash/Flash-Lite candidates and the current production fallback as comparison baselines.

If Luna passes Håfa's quality threshold, use it for routine structured extraction, OCR/vision, and chat. Route a bounded subset of difficult tasks to Terra only when the measured improvement justifies approximately ten times the token price.

## Evaluation requirements

The test set must include:

- clean and noisy video transcripts;
- recipe websites with irrelevant content;
- readable and poor-quality single images;
- multi-page handwritten/printed recipes;
- multi-component recipes;
- missing measurements and ambiguous instructions;
- recipe chat and general food-safety boundary cases.

Compare schema validity, factual completeness, hallucinations, field corrections, latency, retries, reasoning/output tokens, and cost per successful task. Do not select a winner from a few hand-picked examples.

## Routing rules

- Keep model IDs in server configuration by capability.
- Do not expose model branding as a customer-facing product promise.
- Record provider, model, prompt/schema version, latency, token use, and fallback reason.
- Use deterministic validation to trigger escalation; do not ask Luna to decide whether Luna was good enough.
- Roll out by capability and percentage with a configuration rollback.
- Keep `tts-1` initially; separately benchmark current transcription models against `whisper-1`.

## Evaluation boundary

The product owner accepted the Luna-first, Terra-escalation strategy on 2026-08-18. This acceptance authorizes the routing direction, not an unevaluated production model change. Each capability must still pass the comparative evaluation and rollout gates. If Luna cannot meet the quality bar, Terra may become the default for that capability rather than for the entire application.

## Initial recipe/OCR evidence

The privacy-bounded five-category comparison completed on 2026-08-19 at
reasoning effort `none`. Luna achieved 100% task success and schema validity
with zero scored corrections/hallucinations at an estimated $0.006572 total.
Terra achieved 80% task success and 100% schema validity with two scored
measurement inventions in the deliberately incomplete case at an estimated
$0.067489 total. The report is
`api/evals/reports/luna-terra-recipe-extraction-2026-08-19.json`.

Decision unchanged: Luna remains the routine recipe/OCR model. Terra is not a
universal upgrade; it remains a deterministic fallback after a failed schema or
completeness gate. Chat still requires its own focused comparison.

## Official references

- [Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
